import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    EntityManager,
    In,
    LessThan,
    LessThanOrEqual,
    MoreThan,
    Repository,
} from 'typeorm';
import { APITask } from '@/entities/api-task.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import { TaskType } from '@/task-processor/task.enums';
import {
    NewsletterDeliveryStatus,
    NewsletterStatus,
    SubscriberStatus,
    SubscriptionStatus,
} from '@/common/enum';
import type {
    AudienceRecipient,
    SkippedRecipient,
} from '@/newsletter/subscribers/subscription.service';

export interface ClaimedDelivery {
    id: string;
    email: string;
    name: string | null;
    attempts: number;
    subscriberId: string | null;
    /** The subscriber's token; null if the subscriber was erased. */
    token: string | null;
}

export interface AudienceSnapshot {
    recipients: AudienceRecipient[];
    skipped: SkippedRecipient[];
    trackedLinks: string[];
}

const INSERT_CHUNK_SIZE = 500;

// Enum values are inlined into the raw SQL below: compile-time constants,
// never user input.
const D = NewsletterDeliveryStatus;
const N = NewsletterStatus;

/**
 * SQL condition: delivery `d` of the newsletter whose id is `$1` may still
 * go out. Its subscriber exists and is ACTIVE and, when the newsletter
 * targets lists, is still SUBSCRIBED on one of them or was added by address
 * as an ad-hoc recipient. Never NULL, so `NOT (...)` is safe. The list and
 * ad-hoc lookups read `$1` rather than `d."newsletterId"` so Postgres can
 * evaluate them once per statement instead of once per row.
 */
export const DELIVERY_STILL_WANTED_SQL = `
    EXISTS (
        SELECT 1 FROM "subscriber" AS s
        WHERE s."id" = d."subscriberId"
          AND s."status" = '${SubscriberStatus.ACTIVE}'
    )
    AND (
        NOT EXISTS (
            SELECT 1 FROM "newsletter_mailing_list" AS nml
            WHERE nml."newsletterId" = $1
        )
        OR EXISTS (
            SELECT 1
            FROM "newsletter_mailing_list" AS nml
            JOIN "mailing_list_subscription" AS mls
              ON mls."listId" = nml."mailingListId"
            WHERE nml."newsletterId" = $1
              AND mls."subscriberId" = d."subscriberId"
              AND mls."status" = '${SubscriptionStatus.SUBSCRIBED}'
        )
        OR lower(d."email") IN (
            SELECT lower(adhoc."email")
            FROM "newsletter" AS n
            CROSS JOIN LATERAL jsonb_array_elements_text(n."adHocEmails") AS adhoc("email")
            WHERE n."id" = $1 AND adhoc."email" IS NOT NULL
        )
    )`;

/**
 * Every database step of sending, each one safe to run concurrently with
 * itself, with cancellation, and with the stall-recovery cron. Kept apart
 * from NewsletterSendService so the send loop can be tested against an
 * in-memory stand-in.
 */
@Injectable()
export class NewsletterSendStore {
    constructor(
        @InjectRepository(Newsletter)
        private readonly newsletterRepository: Repository<Newsletter>,
        @InjectRepository(NewsletterDelivery)
        private readonly deliveryRepository: Repository<NewsletterDelivery>,
        @InjectRepository(APITask)
        private readonly apiTaskRepository: Repository<
            APITask<TaskType.SEND_NEWSLETTER>
        >,
        private readonly dbTransactionService: DbTransactionService,
    ) {}

    findNewsletter(id: string): Promise<Newsletter | null> {
        return this.newsletterRepository.findOne({
            where: { id },
            relations: { lists: true },
        });
    }

    /** SCHEDULED and due -> SENDING. False if it was not both any more. */
    async startScheduled(id: string, now: Date): Promise<boolean> {
        const result = await this.newsletterRepository.update(
            {
                id,
                status: NewsletterStatus.SCHEDULED,
                scheduledAt: LessThanOrEqual(now),
            },
            { status: NewsletterStatus.SENDING, lastProgressAt: now },
        );
        return (result.affected ?? 0) > 0;
    }

    /**
     * Writes the audience into newsletter_delivery, once. The newsletter row
     * lock makes concurrent runs take turns: the second finds
     * `sendStartedAt` set and writes nothing. False when the newsletter is no
     * longer SENDING.
     */
    async snapshotAudience(
        id: string,
        now: Date,
        prepare: () => Promise<AudienceSnapshot>,
    ): Promise<boolean> {
        return this.dbTransactionService.execute(async (manager) => {
            const locked = await manager
                .createQueryBuilder(Newsletter, 'newsletter')
                .setLock('pessimistic_write')
                .where('newsletter.id = :id', { id })
                .getOne();
            if (!locked || locked.status !== NewsletterStatus.SENDING) {
                return false;
            }
            if (locked.sendStartedAt) return true;

            const snapshot = await prepare();
            const rows = [
                ...snapshot.recipients.map((recipient) => ({
                    newsletter: { id },
                    subscriber: { id: recipient.subscriberId },
                    email: recipient.email,
                    name: recipient.name,
                    status: NewsletterDeliveryStatus.PENDING,
                })),
                ...snapshot.skipped.map((skipped) => ({
                    newsletter: { id },
                    subscriber: null,
                    email: skipped.email,
                    name: null,
                    status: NewsletterDeliveryStatus.SKIPPED,
                    error: skipped.reason,
                })),
            ];
            for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
                // The unique (newsletter, email) index is the backstop: a row
                // that somehow exists already is left as it is.
                await manager
                    .createQueryBuilder()
                    .insert()
                    .into(NewsletterDelivery)
                    .values(rows.slice(i, i + INSERT_CHUNK_SIZE))
                    .orIgnore()
                    .updateEntity(false)
                    .execute();
            }

            const total = await manager.count(NewsletterDelivery, {
                where: { newsletter: { id } },
            });
            await manager.update(
                Newsletter,
                { id },
                {
                    totalRecipients: total,
                    trackedLinks: snapshot.trackedLinks,
                    sendStartedAt: now,
                    lastProgressAt: now,
                },
            );
            return true;
        });
    }

    /**
     * PENDING deliveries whose address has since been unsubscribed (from
     * everything, or from every list the newsletter targets), bounced or
     * erased become SKIPPED: a send can take days under the daily limit, and
     * an unsubscribe has to hold from the moment it is made.
     */
    async skipSuppressed(newsletterId: string): Promise<void> {
        await this.deliveryRepository.query(
            `
            UPDATE "newsletter_delivery" AS d
            SET "status" = '${D.SKIPPED}',
                "claimedAt" = NULL,
                "error" = CASE (SELECT s."status" FROM "subscriber" AS s WHERE s."id" = d."subscriberId")
                    WHEN '${SubscriberStatus.BOUNCED}' THEN 'Bounced before this newsletter reached them'
                    WHEN '${SubscriberStatus.UNSUBSCRIBED}' THEN 'Unsubscribed before this newsletter reached them'
                    WHEN '${SubscriberStatus.ACTIVE}' THEN 'Unsubscribed from the lists before this newsletter reached them'
                    ELSE 'Address erased before this newsletter reached them'
                END
            WHERE d."newsletterId" = $1
              AND d."status" = '${D.PENDING}'
              AND NOT (${DELIVERY_STILL_WANTED_SQL})
            `,
            [newsletterId],
        );
    }

    /** Newsletter emails sent after `since`, across every newsletter. */
    countSentSince(since: Date): Promise<number> {
        return this.deliveryRepository.count({
            where: { sentAt: MoreThan(since) },
        });
    }

    /**
     * What the daily limit has left to give, as used: emails sent after
     * `since` plus those claimed by a batch in flight since `claimedSince`
     * (older claims are stale and go back to PENDING), across every
     * newsletter. Counting the in-flight ones keeps two newsletters sending
     * at once from each spending the same remaining budget.
     */
    async countSentOrInFlight(
        since: Date,
        claimedSince: Date,
    ): Promise<number> {
        // A delivery only leaves SENDING for SENT, so the two never overlap.
        // In-flight rows only exist for SENDING newsletters; going through
        // them lets the (newsletterId, status) index find the rows.
        const [{ used }]: { used: number }[] =
            await this.deliveryRepository.query(
                `
                SELECT (
                    (SELECT COUNT(*) FROM "newsletter_delivery" WHERE "sentAt" > $1)
                    + (
                        SELECT COUNT(*) FROM "newsletter_delivery"
                        WHERE "newsletterId" IN (
                                SELECT "id" FROM "newsletter" WHERE "status" = '${N.SENDING}'
                            )
                          AND "status" = '${D.SENDING}'
                          AND "claimedAt" >= $2
                    )
                )::int AS "used"
                `,
                [since, claimedSince],
            );
        return used;
    }

    /** The `offset`-th oldest send after `since` (0 = oldest). */
    async sentAtAtOffset(since: Date, offset: number): Promise<Date | null> {
        const row = await this.deliveryRepository
            .createQueryBuilder('delivery')
            .select('delivery.sentAt', 'sentAt')
            .where('delivery.sentAt > :since', { since })
            .orderBy('delivery.sentAt', 'ASC')
            .offset(offset)
            .limit(1)
            .getRawOne<{ sentAt: Date | string }>();
        return row ? new Date(row.sentAt) : null;
    }

    /**
     * Claims up to `size` PENDING deliveries, fresh ones before retries.
     * Null when the newsletter is not SENDING, or another run already has a
     * batch in flight for it: one batch at a time per newsletter keeps the
     * pacing honest even if duplicate tasks exist.
     */
    async claimBatch(
        newsletterId: string,
        size: number,
        claimedAt: Date,
    ): Promise<ClaimedDelivery[] | null> {
        return this.dbTransactionService.execute(async (manager) => {
            // Serialises claimers of this newsletter until commit.
            const sending: unknown[] = await manager.query(
                `SELECT "id" FROM newsletter WHERE "id" = $1 AND "status" = '${N.SENDING}' FOR UPDATE`,
                [newsletterId],
            );
            if (sending.length === 0) return null;

            const inFlight = await manager.count(NewsletterDelivery, {
                where: {
                    newsletter: { id: newsletterId },
                    status: NewsletterDeliveryStatus.SENDING,
                },
            });
            if (inFlight > 0) return null;

            const claimed: ClaimedDelivery[] = await manager.query(
                `
                WITH claimed AS (
                    UPDATE newsletter_delivery
                    SET "status" = '${D.SENDING}', "claimedAt" = $2
                    WHERE "id" IN (
                        SELECT "id" FROM newsletter_delivery
                        WHERE "newsletterId" = $1 AND "status" = '${D.PENDING}'
                        ORDER BY "attempts", "createdAt", "id"
                        LIMIT $3
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING "id", "email", "name", "attempts", "subscriberId", "createdAt"
                )
                SELECT claimed."id", claimed."email", claimed."name", claimed."attempts",
                       claimed."subscriberId", subscriber."token"
                FROM claimed
                LEFT JOIN subscriber ON subscriber."id" = claimed."subscriberId"
                ORDER BY claimed."attempts", claimed."createdAt", claimed."id"
                `,
                [newsletterId, claimedAt, size],
            );
            return claimed;
        });
    }

    /**
     * Right before each email: the delivery is still ours (claimed at
     * `claimedAt`, not reset and re-claimed by someone else) and the
     * newsletter is still SENDING and not paused. Moves `claimedAt` to
     * `touchedAt`, so stall recovery cannot take the row back mid-send.
     */
    async reconfirmClaim(
        newsletterId: string,
        deliveryId: string,
        claimedAt: Date,
        touchedAt: Date,
    ): Promise<boolean> {
        const [, affected]: [unknown, number] =
            await this.deliveryRepository.query(
                `
                UPDATE newsletter_delivery AS d
                SET "claimedAt" = $4
                FROM newsletter AS n
                WHERE d."id" = $2
                  AND d."status" = '${D.SENDING}'
                  AND d."claimedAt" = $3
                  AND n."id" = $1
                  AND d."newsletterId" = n."id"
                  AND n."status" = '${N.SENDING}'
                  AND (n."pausedUntil" IS NULL OR n."pausedUntil" <= $4)
                `,
                [newsletterId, deliveryId, claimedAt, touchedAt],
            );
        return affected > 0;
    }

    /** SENDING and not paused into the future. */
    async isSending(newsletterId: string, now: Date): Promise<boolean> {
        const newsletter = await this.newsletterRepository.findOne({
            where: { id: newsletterId },
            select: { id: true, status: true, pausedUntil: true },
        });
        return (
            newsletter?.status === NewsletterStatus.SENDING &&
            !(newsletter.pausedUntil && newsletter.pausedUntil > now)
        );
    }

    /**
     * Unconditional: the email has gone, so the row says so even if the
     * newsletter was cancelled while it was on the wire.
     */
    async markSent(deliveryId: string, sentAt: Date): Promise<void> {
        await this.deliveryRepository.update(
            { id: deliveryId },
            {
                status: NewsletterDeliveryStatus.SENT,
                sentAt,
                claimedAt: null,
                error: null,
            },
        );
    }

    async markFailed(
        deliveryId: string,
        claimedAt: Date,
        attempts: number,
        error: string,
    ): Promise<void> {
        await this.deliveryRepository.update(
            {
                id: deliveryId,
                status: NewsletterDeliveryStatus.SENDING,
                claimedAt,
            },
            {
                status: NewsletterDeliveryStatus.FAILED,
                attempts,
                error,
                claimedAt: null,
            },
        );
    }

    async markForRetry(
        deliveryId: string,
        claimedAt: Date,
        attempts: number,
        error: string,
    ): Promise<void> {
        await this.deliveryRepository.update(
            {
                id: deliveryId,
                status: NewsletterDeliveryStatus.SENDING,
                claimedAt,
            },
            {
                status: NewsletterDeliveryStatus.PENDING,
                attempts,
                error,
                claimedAt: null,
            },
        );
    }

    /**
     * Back to PENDING without spending an attempt. Only rows still held under
     * `claimedAt`, so a cancel (SKIPPED) or another run's claim is untouched.
     */
    async releaseClaims(deliveryIds: string[], claimedAt: Date): Promise<void> {
        if (deliveryIds.length === 0) return;
        await this.deliveryRepository.update(
            {
                id: In(deliveryIds),
                status: NewsletterDeliveryStatus.SENDING,
                claimedAt,
            },
            { status: NewsletterDeliveryStatus.PENDING, claimedAt: null },
        );
    }

    /** Pauses a SENDING newsletter and queues the run that resumes it. */
    async pause(
        newsletterId: string,
        until: Date,
        reason: string,
        now: Date,
    ): Promise<void> {
        await this.dbTransactionService.execute(async (manager) => {
            const result = await manager.update(
                Newsletter,
                { id: newsletterId, status: NewsletterStatus.SENDING },
                {
                    pausedUntil: until,
                    pauseReason: reason,
                    lastProgressAt: now,
                },
            );
            if (result.affected)
                await this.enqueue(newsletterId, until, manager);
        });
    }

    async clearPause(newsletterId: string): Promise<void> {
        await this.newsletterRepository.update(
            { id: newsletterId },
            { pausedUntil: null, pauseReason: null },
        );
    }

    async touchProgress(newsletterId: string, now: Date): Promise<void> {
        await this.newsletterRepository.update(
            { id: newsletterId },
            { lastProgressAt: now },
        );
    }

    countPending(newsletterId: string): Promise<number> {
        return this.deliveryRepository.count({
            where: {
                newsletter: { id: newsletterId },
                status: NewsletterDeliveryStatus.PENDING,
            },
        });
    }

    /** SENDING -> SENT, only once nothing is PENDING or in flight. */
    async complete(newsletterId: string, now: Date): Promise<boolean> {
        const [, affected]: [unknown, number] =
            await this.newsletterRepository.query(
                `
                UPDATE newsletter
                SET "status" = '${N.SENT}', "sentAt" = $2, "lastProgressAt" = $2,
                    "pausedUntil" = NULL, "pauseReason" = NULL
                WHERE "id" = $1
                  AND "status" = '${N.SENDING}'
                  AND NOT EXISTS (
                      SELECT 1 FROM newsletter_delivery
                      WHERE "newsletterId" = $1
                        AND "status" IN ('${D.PENDING}', '${D.SENDING}')
                  )
                `,
                [newsletterId, now],
            );
        return affected > 0;
    }

    async enqueue(
        newsletterId: string,
        executeOnTime: Date,
        manager?: EntityManager,
    ): Promise<void> {
        const task = new APITask<TaskType.SEND_NEWSLETTER>();
        task.type = TaskType.SEND_NEWSLETTER;
        task.data = { newsletterId };
        task.executeOnTime = executeOnTime;
        await (manager ?? this.apiTaskRepository.manager).save(task);
    }

    /** SENDING deliveries claimed before `before` go back to PENDING. */
    async releaseStaleClaims(before: Date): Promise<number> {
        const result = await this.deliveryRepository.update(
            {
                status: NewsletterDeliveryStatus.SENDING,
                claimedAt: LessThan(before),
            },
            { status: NewsletterDeliveryStatus.PENDING, claimedAt: null },
        );
        return result.affected ?? 0;
    }

    /**
     * Queues a run for every newsletter that should be moving but has gone
     * quiet since `quietSince`. Bumping `lastProgressAt` in the same UPDATE
     * means that when several app instances run this at once, each
     * newsletter is picked up by exactly one of them.
     */
    async requeueStalled(now: Date, quietSince: Date): Promise<string[]> {
        return this.dbTransactionService.execute(async (manager) => {
            const [rows]: [{ id: string }[], number] = await manager.query(
                `
                UPDATE newsletter
                SET "lastProgressAt" = $1
                WHERE ("lastProgressAt" IS NULL OR "lastProgressAt" < $2)
                  AND (
                      ("status" = '${N.SENDING}' AND ("pausedUntil" IS NULL OR "pausedUntil" <= $1))
                      OR ("status" = '${N.SCHEDULED}' AND "scheduledAt" < $2)
                  )
                RETURNING "id"
                `,
                [now, quietSince],
            );
            for (const { id } of rows) await this.enqueue(id, now, manager);
            return rows.map(({ id }) => id);
        });
    }
}
