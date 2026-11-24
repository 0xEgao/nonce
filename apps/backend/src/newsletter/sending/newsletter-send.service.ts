import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from 'typeorm';
import { APITask } from '@/entities/api-task.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterStatus } from '@/common/enum';
import { TaskType } from '@/task-processor/task.enums';
import {
    NEWSLETTER_MAX_SEND_ATTEMPTS,
    NEWSLETTER_SEND_BATCH_SIZE,
    NEWSLETTER_STALE_CLAIM_MS,
    NEWSLETTER_STALL_THRESHOLD_MS,
    NEWSLETTER_THROTTLE_PAUSE_MS,
} from '@/newsletter/newsletter.constants';
import { NewsletterMailerService } from '@/newsletter/sending/newsletter-mailer.service';
import { NewsletterRenderService } from '@/newsletter/rendering/newsletter-render.service';
import {
    AudienceSnapshot,
    ClaimedDelivery,
    NewsletterSendStore,
} from '@/newsletter/sending/newsletter-send.store';
import { readNewsletterSettings } from '@/newsletter/newsletter-settings';
import {
    classifySmtpError,
    describeSmtpError,
    describeThrottle,
} from '@/newsletter/sending/newsletter-smtp-errors';
import { extractTrackableLinks } from '@/newsletter/tracking/newsletter-tracking.util';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// This many failures in a row (bounces included) pause the send. Real lists
// do not fail like that; a sender-side problem the classifier did not
// recognise does, and would otherwise burn through every recipient's
// attempts, or suppress them as bounced.
const FAILURE_STREAK_LIMIT = 10;

// Resume a little after the window has room again, never on the boundary.
const DAILY_LIMIT_RESUME_MARGIN_MS = 60 * 1000;

type BatchOutcome = 'done' | 'paused' | 'stopped';

/**
 * Drives a newsletter from SENDING to SENT in paced batches, within the
 * rolling daily limit. Every run handles one batch and queues the next.
 */
@Injectable()
export class NewsletterSendService {
    private readonly logger = new Logger(NewsletterSendService.name);
    private readonly dailyLimit: number;
    private readonly intervalMs: number;
    // A batch must finish well inside the stale-claim window, or stall
    // recovery would hand its unsent rows to another run. At slow paces that
    // means fewer emails per batch.
    private readonly maxBatchSize: number;

    /** Waits between emails. Replaced in tests so batches run instantly. */
    sleep: (ms: number) => Promise<void> = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    constructor(
        private readonly store: NewsletterSendStore,
        private readonly subscriptionService: SubscriptionService,
        private readonly renderService: NewsletterRenderService,
        private readonly mailer: NewsletterMailerService,
        configService: ConfigService,
    ) {
        const settings = readNewsletterSettings(configService);
        this.dailyLimit = settings.dailyLimit;
        this.intervalMs = Math.ceil(60_000 / settings.ratePerMinute);
        this.maxBatchSize = Math.max(
            1,
            Math.min(
                NEWSLETTER_SEND_BATCH_SIZE,
                Math.floor(NEWSLETTER_STALE_CLAIM_MS / 3 / this.intervalMs),
            ),
        );
    }

    /** The SEND_NEWSLETTER task. Idempotent; safe to run concurrently. */
    async handleSendNewsletter(
        task: APITask<TaskType.SEND_NEWSLETTER>,
    ): Promise<void> {
        const { newsletterId } = task.data;
        const now = new Date();

        let newsletter = await this.store.findNewsletter(newsletterId);
        if (!newsletter) return;

        if (newsletter.status === NewsletterStatus.SCHEDULED) {
            // An unschedule-and-reschedule leaves the old task behind; it
            // arrives early and finds nothing due.
            if (!newsletter.scheduledAt || newsletter.scheduledAt > now) return;
            await this.store.startScheduled(newsletterId, now);
            newsletter = await this.store.findNewsletter(newsletterId);
            if (!newsletter) return;
        }
        if (newsletter.status !== NewsletterStatus.SENDING) return;
        // The run that paused it queued the resume for pausedUntil.
        if (newsletter.pausedUntil && newsletter.pausedUntil > now) return;

        if (!newsletter.sendStartedAt) {
            const toSnapshot = newsletter;
            const stillSending = await this.store.snapshotAudience(
                newsletterId,
                now,
                () => this.resolveSnapshot(toSnapshot),
            );
            if (!stillSending) return;
            // Reloaded for the tracked links, whichever run wrote them.
            newsletter = await this.store.findNewsletter(newsletterId);
            if (newsletter?.status !== NewsletterStatus.SENDING) return;
        }

        await this.sendBatch(newsletter);
    }

    /** Queues a SEND_NEWSLETTER run, inside `manager`'s transaction when given. */
    async enqueue(
        newsletterId: string,
        executeOnTime: Date,
        manager?: EntityManager,
    ): Promise<void> {
        await this.store.enqueue(newsletterId, executeOnTime, manager);
    }

    /** Newsletter emails SENT in the last 24h, across every newsletter. */
    async countSentLast24h(): Promise<number> {
        return this.store.countSentSince(new Date(Date.now() - DAY_MS));
    }

    /**
     * Stall recovery, every 5 minutes: un-claims long-SENDING deliveries and
     * re-queues newsletters whose progress has gone quiet. Safe on several
     * app instances at once.
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async recoverStalledSends(): Promise<void> {
        try {
            const now = Date.now();
            const released = await this.store.releaseStaleClaims(
                new Date(now - NEWSLETTER_STALE_CLAIM_MS),
            );
            const requeued = await this.store.requeueStalled(
                new Date(now),
                new Date(now - NEWSLETTER_STALL_THRESHOLD_MS),
            );
            if (released > 0 || requeued.length > 0) {
                this.logger.warn(
                    `Stall recovery: released ${released} stale claim(s), re-queued ${requeued.length} newsletter(s)${requeued.length ? ` (${requeued.join(', ')})` : ''}`,
                );
            }
        } catch (error) {
            this.logger.error(
                `Newsletter stall recovery failed: ${error.message}`,
                error.stack,
            );
        }
    }

    private async resolveSnapshot(
        newsletter: Newsletter,
    ): Promise<AudienceSnapshot> {
        const audience = await this.subscriptionService.resolveAudience(
            newsletter.lists.map((list) => list.id),
            newsletter.adHocEmails,
        );
        if (audience.invalid.length > 0) {
            this.logger.warn(
                `Newsletter ${newsletter.id}: ignoring ${audience.invalid.length} malformed ad-hoc address(es)`,
            );
        }
        return {
            recipients: audience.recipients,
            skipped: audience.skipped,
            trackedLinks: newsletter.trackingEnabled
                ? extractTrackableLinks(
                      this.renderService.buildTemplate(newsletter),
                  )
                : [],
        };
    }

    private async sendBatch(newsletter: Newsletter): Promise<void> {
        const id = newsletter.id;
        await this.store.skipSuppressed(id);

        // Other newsletters' batches in flight count as spent: they claimed
        // their share of the budget already, and will send it.
        const now = Date.now();
        const used = await this.store.countSentOrInFlight(
            new Date(now - DAY_MS),
            new Date(now - NEWSLETTER_STALE_CLAIM_MS),
        );
        const budget = this.dailyLimit - used;
        if (budget <= 0) {
            await this.pauseForDailyLimit(id, used);
            return;
        }

        const claimedAt = new Date();
        const batch = await this.store.claimBatch(
            id,
            Math.min(budget, this.maxBatchSize),
            claimedAt,
        );
        // Not SENDING any more, or another run has a batch in flight and
        // will queue the next one itself.
        if (batch === null) return;
        if (batch.length === 0) {
            await this.finish(id);
            return;
        }

        if (newsletter.pausedUntil || newsletter.pauseReason) {
            await this.store.clearPause(id);
        }

        const outcome = await this.sendClaimed(newsletter, batch, claimedAt);
        if (outcome !== 'done') return;

        await this.store.touchProgress(id, new Date());
        if ((await this.store.countPending(id)) > 0) {
            await this.store.enqueue(
                id,
                new Date(Date.now() + this.intervalMs),
            );
        } else {
            await this.finish(id);
        }
    }

    private async sendClaimed(
        newsletter: Newsletter,
        batch: ClaimedDelivery[],
        claimedAt: Date,
    ): Promise<BatchOutcome> {
        let failureStreak = 0;
        let index = 0;
        try {
            for (; index < batch.length; index++) {
                const delivery = batch[index];
                if (index > 0) await this.sleep(this.intervalMs);

                const touchedAt = new Date();
                const stillOurs = await this.store.reconfirmClaim(
                    newsletter.id,
                    delivery.id,
                    claimedAt,
                    touchedAt,
                );
                if (!stillOurs) {
                    // Cancelled or paused under us: stop. Otherwise only this
                    // row was taken back (stall recovery); carry on.
                    if (await this.store.isSending(newsletter.id, touchedAt)) {
                        continue;
                    }
                    // From this row on: it was never sent, and if a cancel or
                    // another run has it, it is no longer held under
                    // `claimedAt`, so the release leaves it alone.
                    await this.releaseUnsent(batch, index, claimedAt);
                    return 'stopped';
                }

                let failure: { error: unknown } | null = null;
                try {
                    if (!delivery.token) {
                        // Erased since the claim; the next batch skips it.
                        throw new Error('The subscriber no longer exists');
                    }
                    const rendered = this.renderService.render(
                        newsletter,
                        {
                            email: delivery.email,
                            name: delivery.name,
                            token: delivery.token,
                        },
                        { mode: 'send', deliveryId: delivery.id },
                    );
                    await this.mailer.send({
                        to: delivery.email,
                        toName: delivery.name,
                        subject: rendered.subject,
                        html: rendered.html,
                        text: rendered.text,
                        headers: rendered.headers,
                        replyTo: newsletter.replyTo,
                    });
                } catch (error) {
                    failure = { error };
                }

                // Outside the try above: a failed status write after a
                // successful send must never be mistaken for a failed send.
                if (!failure) {
                    await this.recordSent(delivery.id);
                    failureStreak = 0;
                    continue;
                }

                const { error } = failure;
                const kind = classifySmtpError(error);
                if (kind === 'throttled') {
                    await this.pauseFor(
                        newsletter.id,
                        NEWSLETTER_THROTTLE_PAUSE_MS,
                        describeThrottle(error),
                    );
                    await this.store.releaseClaims([delivery.id], touchedAt);
                    await this.releaseUnsent(batch, index + 1, claimedAt);
                    return 'paused';
                }

                const message = describeSmtpError(error);
                const attempts = delivery.attempts + 1;
                if (kind === 'bounced') {
                    await this.store.markFailed(
                        delivery.id,
                        touchedAt,
                        attempts,
                        message,
                    );
                    if (delivery.subscriberId) {
                        await this.markBounced(delivery.subscriberId, message);
                    }
                } else if (attempts >= NEWSLETTER_MAX_SEND_ATTEMPTS) {
                    await this.store.markFailed(
                        delivery.id,
                        touchedAt,
                        attempts,
                        message,
                    );
                } else {
                    await this.store.markForRetry(
                        delivery.id,
                        touchedAt,
                        attempts,
                        message,
                    );
                }

                failureStreak++;
                if (failureStreak >= FAILURE_STREAK_LIMIT) {
                    await this.pauseFor(
                        newsletter.id,
                        NEWSLETTER_THROTTLE_PAUSE_MS,
                        `${failureStreak} sends in a row failed; the last one: ${message}. Sending retries automatically.`,
                    );
                    await this.releaseUnsent(batch, index + 1, claimedAt);
                    return 'paused';
                }
            }
            return 'done';
        } catch (error) {
            // A database error mid-batch: hand back what was not attempted
            // rather than leaving it for stall recovery.
            await this.releaseUnsent(batch, index + 1, claimedAt).catch(
                () => undefined,
            );
            throw error;
        }
    }

    // The email is out: if this write were lost, stall recovery would put
    // the row back to PENDING and it would go out twice.
    private async recordSent(deliveryId: string): Promise<void> {
        for (let attempt = 1; ; attempt++) {
            try {
                await this.store.markSent(deliveryId, new Date());
                return;
            } catch (error) {
                if (attempt >= 3) throw error;
                await this.sleep(1000 * attempt);
            }
        }
    }

    private async releaseUnsent(
        batch: ClaimedDelivery[],
        from: number,
        claimedAt: Date,
    ): Promise<void> {
        await this.store.releaseClaims(
            batch.slice(from).map((delivery) => delivery.id),
            claimedAt,
        );
    }

    /** `used`: sent in the window plus in flight, as the budget counted it. */
    private async pauseForDailyLimit(
        newsletterId: string,
        used: number,
    ): Promise<void> {
        const now = Date.now();
        const since = new Date(now - DAY_MS);
        const sent = await this.store.countSentSince(since);
        // Wait until enough of the window has aged out for a full batch,
        // rather than waking for every single slot.
        const mustAgeOut =
            used -
            this.dailyLimit +
            Math.min(this.maxBatchSize, this.dailyLimit);
        const offset = Math.max(0, Math.min(mustAgeOut, sent) - 1);
        const agesOutFrom = await this.store.sentAtAtOffset(since, offset);
        const resumeAt = agesOutFrom
            ? Math.max(agesOutFrom.getTime() + DAY_MS, now)
            : now + NEWSLETTER_THROTTLE_PAUSE_MS;

        await this.store.pause(
            newsletterId,
            new Date(resumeAt + DAILY_LIMIT_RESUME_MARGIN_MS),
            `Reached the limit of ${this.dailyLimit} newsletter emails per 24 hours (all newsletters together). Sending resumes automatically.`,
            new Date(now),
        );
    }

    private async pauseFor(
        newsletterId: string,
        durationMs: number,
        reason: string,
    ): Promise<void> {
        const now = Date.now();
        this.logger.warn(`Pausing newsletter ${newsletterId}: ${reason}`);
        await this.store.pause(
            newsletterId,
            new Date(now + durationMs),
            reason,
            new Date(now),
        );
    }

    /** SENT once nothing is left; or carry on if something reappeared. */
    private async finish(newsletterId: string): Promise<void> {
        if (await this.store.complete(newsletterId, new Date())) {
            this.logger.log(`Newsletter ${newsletterId} sent`);
            return;
        }
        // A retry-failed may have reset rows after this run looked. Deliveries
        // still in flight belong to a run that queues its own successor.
        if ((await this.store.countPending(newsletterId)) > 0) {
            await this.store.enqueue(newsletterId, new Date());
        }
    }

    private async markBounced(
        subscriberId: string,
        reason: string,
    ): Promise<void> {
        try {
            await this.subscriptionService.markBounced(subscriberId, reason);
        } catch (error) {
            this.logger.error(
                `Could not mark subscriber ${subscriberId} as bounced: ${error.message}`,
                error.stack,
            );
        }
    }
}
