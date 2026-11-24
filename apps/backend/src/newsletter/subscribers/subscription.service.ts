import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import type {
    ConfirmSubscriptionResponse,
    PublicMailingListResponse,
    PublicSubscribeRequest,
    SubscriberPreferencesResponse,
    UnsubscribeRequest,
    UnsubscribeResponse,
    UpdatePreferencesRequest,
} from '@nonce/shared';
import { DiscordAlertService } from '@/common/discord-alert.service';
import { TWENTY_FOUR_HOURS_MS } from '@/common/durations.constants';
import {
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { ServiceError } from '@/common/errors';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import { MailService } from '@/mail/mail.service';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import {
    NEWSLETTER_CONFIRMATION_CAP_ALERT_INTERVAL_MS,
    NEWSLETTER_CONFIRMATION_DAILY_CAP,
    NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS,
} from '@/newsletter/newsletter.constants';
import {
    generateSubscriberToken,
    isValidEmail,
    normalizeEmail,
} from '@/newsletter/newsletter.utils';
import {
    PublicMailingListResponseDto,
    SubscriberPreferenceListDto,
} from '@/newsletter/subscribers/subscription.response.dto';
import {
    chunk,
    insertIgnoringConflicts,
    partitionEmails,
} from '@/newsletter/subscribers/subscription.util';

export interface AudienceRecipient {
    subscriberId: string;
    email: string;
    name: string | null;
}

/**
 * A dry run creates nothing, so an ad-hoc address that has no subscriber row
 * yet comes back with a null `subscriberId`. Every other recipient has one.
 */
export interface DryRunAudienceRecipient extends Omit<
    AudienceRecipient,
    'subscriberId'
> {
    subscriberId: string | null;
}

export interface SkippedRecipient {
    email: string;
    /** Why the address is suppressed; stored as the SKIPPED delivery's `error`. */
    reason: string;
}

export interface ResolvedAudience<TRecipient = AudienceRecipient> {
    /** Unique by email. */
    recipients: TRecipient[];
    /** Suppressed addresses, unique by email and never also a recipient. */
    skipped: SkippedRecipient[];
    /** Malformed ad-hoc addresses, as given. */
    invalid: string[];
}

export interface ResolveAudienceOptions {
    /** Count only: do not create subscribers for new ad-hoc addresses. */
    dryRun?: boolean;
}

// The SKIPPED delivery reason for each suppressed status.
const SUPPRESSION_REASONS: Record<SubscriberStatus, string> = {
    [SubscriberStatus.ACTIVE]: '',
    [SubscriberStatus.UNSUBSCRIBED]: 'Unsubscribed',
    [SubscriberStatus.BOUNCED]: 'Bounced',
};

const UNSUBSCRIBED_EVERYWHERE_REASON = 'Unsubscribed from all lists';

// Keeps each insert well under Postgres' 65,535 bind parameters.
const AD_HOC_INSERT_CHUNK_SIZE = 1000;

// A confirmation or preferences-link email that has been charged to the
// address's resend window (and so to the daily cap), and what to restore if it
// never leaves.
interface ClaimedEmail {
    subscriberId: string;
    email: string;
    token: string;
    sentAt: Date;
    previousSentAt: Date | null;
}

// What a public sign-up leaves to do once its transaction has committed.
interface PendingConfirmation extends ClaimedEmail {
    listNames: string[];
}

const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

/**
 * Subscriber and subscription state: the public double opt-in flow, the
 * preferences pages (by token, or a link to them mailed to a signed-in user),
 * and the audience a newsletter resolves to.
 */
@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);
    // When the daily cap last alerted Discord, per process.
    private lastCapAlertAt: number | null = null;

    constructor(
        @InjectRepository(Subscriber)
        private readonly subscriberRepository: Repository<Subscriber>,
        @InjectRepository(MailingList)
        private readonly listRepository: Repository<MailingList>,
        @InjectRepository(MailingListSubscription)
        private readonly subscriptionRepository: Repository<MailingListSubscription>,
        @InjectRepository(Newsletter)
        private readonly newsletterRepository: Repository<Newsletter>,
        private readonly dbTransactionService: DbTransactionService,
        private readonly mailService: MailService,
        private readonly urlService: NewsletterUrlService,
        private readonly discordAlert: DiscordAlertService,
    ) {}

    // --- Seams used by sending ---

    /**
     * SUBSCRIBED rows of the given lists whose subscriber is ACTIVE, plus the
     * ad-hoc addresses (upserted as subscribers with no list row unless
     * `dryRun`), deduplicated by email. Suppressed addresses come back in
     * `skipped`, malformed ad-hoc ones in `invalid`.
     *
     * One read for the lists and the ad-hoc addresses together; a real run
     * adds one insert and one read for ad-hoc addresses never seen before.
     */
    resolveAudience(
        listIds: string[],
        adHocEmails: string[],
        options?: { dryRun?: false },
    ): Promise<ResolvedAudience>;
    resolveAudience(
        listIds: string[],
        adHocEmails: string[],
        options: ResolveAudienceOptions,
    ): Promise<ResolvedAudience<DryRunAudienceRecipient>>;
    async resolveAudience(
        listIds: string[],
        adHocEmails: string[],
        options: ResolveAudienceOptions = {},
    ): Promise<ResolvedAudience<DryRunAudienceRecipient>> {
        const uniqueListIds = [...new Set(listIds)];
        const { valid: adHoc, invalid } = partitionEmails(adHocEmails);
        if (uniqueListIds.length === 0 && adHoc.length === 0) {
            return { recipients: [], skipped: [], invalid };
        }

        const known = await this.findAudienceSubscribers(uniqueListIds, adHoc);
        const knownEmails = new Set(known.map((s) => s.email));
        let unknown = adHoc.filter((email) => !knownEmails.has(email));

        const created: Subscriber[] = [];
        if (unknown.length > 0 && !options.dryRun) {
            for (const batch of chunk(unknown, AD_HOC_INSERT_CHUNK_SIZE)) {
                await insertIgnoringConflicts(
                    this.subscriberRepository.manager,
                    Subscriber,
                    batch.map((email) => ({
                        email,
                        token: generateSubscriberToken(),
                    })),
                );
                created.push(
                    ...(await this.subscriberRepository.find({
                        where: { email: In(batch) },
                    })),
                );
            }
            unknown = [];
        }

        const recipients: DryRunAudienceRecipient[] = [];
        const skipped: SkippedRecipient[] = [];
        for (const subscriber of [...known, ...created]) {
            if (subscriber.status === SubscriberStatus.ACTIVE) {
                recipients.push({
                    subscriberId: subscriber.id,
                    email: subscriber.email,
                    name: subscriber.name,
                });
            } else {
                skipped.push({
                    email: subscriber.email,
                    reason: SUPPRESSION_REASONS[subscriber.status],
                });
            }
        }
        // Only a dry run gets here with addresses left over.
        for (const email of unknown) {
            recipients.push({ subscriberId: null, email, name: null });
        }

        return { recipients, skipped, invalid };
    }

    /**
     * A permanent recipient rejection: suppress the address everywhere. An
     * address that already unsubscribed keeps that status; it records the
     * person's own choice, and either one stops every send.
     */
    async markBounced(subscriberId: string, reason: string): Promise<void> {
        await this.subscriberRepository.update(
            { id: subscriberId, status: SubscriberStatus.ACTIVE },
            {
                status: SubscriberStatus.BOUNCED,
                statusReason: reason.slice(0, 1000),
                statusChangedAt: new Date(),
            },
        );
    }

    // --- Public, by token ---

    async listPublicLists(): Promise<PublicMailingListResponse[]> {
        const lists = await this.listRepository.find({
            where: { isPublic: true, archivedAt: IsNull() },
            order: { name: 'ASC' },
        });
        return lists.map((list) => new PublicMailingListResponseDto(list));
    }

    /**
     * Resolves the same way whether or not the address was known; the
     * controller always answers with NEWSLETTER_SUBSCRIBE_MESSAGE.
     */
    async subscribe(request: PublicSubscribeRequest): Promise<void> {
        if (request.website?.trim()) return;

        const email = normalizeEmail(request.email);
        if (!isValidEmail(email)) return;

        const slugs = [
            ...new Set(
                request.listSlugs.map((slug) => slug.trim().toLowerCase()),
            ),
        ];
        if (slugs.length === 0) return;

        const lists = await this.listRepository.find({
            where: { slug: In(slugs), isPublic: true, archivedAt: IsNull() },
        });
        if (lists.length === 0) return;

        const confirmation = await this.dbTransactionService.execute(
            (manager) =>
                this.recordSignUp(
                    manager,
                    email,
                    request.name?.trim() || null,
                    lists,
                ),
        );

        // Not awaited: how long the request takes must not reveal whether an
        // email went out, i.e. whether the address was already subscribed.
        if (confirmation) {
            this.dispatch(confirmation, 'confirmation', () =>
                this.mailService.sendNewsletterSubscriptionConfirmationEmail(
                    confirmation.email,
                    confirmation.listNames,
                    this.urlService.confirmUrl(confirmation.token),
                ),
            );
        }
    }

    async confirm(token: string): Promise<ConfirmSubscriptionResponse> {
        const subscriber = await this.findByTokenOrFail(token);
        const now = new Date();

        await this.dbTransactionService.execute(async (manager) => {
            const pending = await manager.find(MailingListSubscription, {
                where: {
                    subscriber: { id: subscriber.id },
                    status: SubscriptionStatus.PENDING,
                },
            });
            // Nothing pending means a repeat click, or an old link: neither
            // may undo a global unsubscribe made since.
            if (pending.length === 0) return;

            await manager.update(
                MailingListSubscription,
                { id: In(pending.map((row) => row.id)) },
                {
                    status: SubscriptionStatus.SUBSCRIBED,
                    confirmedAt: now,
                    unsubscribedAt: null,
                },
            );
            // Confirming proves the inbox works and wants mail.
            await this.setSubscriberStatus(
                manager,
                subscriber,
                SubscriberStatus.ACTIVE,
                null,
                now,
            );
        });

        // Everything the address is now subscribed to, so a repeat click
        // shows the same answer as the first.
        const subscribed = await this.subscriptionRepository.find({
            where: {
                subscriber: { id: subscriber.id },
                status: SubscriptionStatus.SUBSCRIBED,
                list: { archivedAt: IsNull() },
            },
            relations: { list: true },
        });
        return {
            email: subscriber.email,
            lists: subscribed
                .map((row) => row.list)
                .sort(byName)
                .map((list) => list.name),
        };
    }

    async getPreferencesByToken(
        token: string,
    ): Promise<SubscriberPreferencesResponse> {
        const subscriber = await this.findByTokenOrFail(token);
        return this.buildPreferences(subscriber);
    }

    async updatePreferencesByToken(
        token: string,
        request: UpdatePreferencesRequest,
    ): Promise<SubscriberPreferencesResponse> {
        const subscriber = await this.findByTokenOrFail(token);
        await this.applyPreferences(subscriber, request);
        return this.buildPreferences(
            await this.subscriberRepository.findOneByOrFail({
                id: subscriber.id,
            }),
        );
    }

    async unsubscribe(
        request: UnsubscribeRequest,
    ): Promise<UnsubscribeResponse> {
        const subscriber = await this.findByTokenOrFail(request.token);
        const rows = await this.subscriptionRepository.find({
            where: { subscriber: { id: subscriber.id } },
            relations: { list: true },
        });

        let global = request.all === true || !request.newsletterId;
        let scoped = rows;
        if (!global && request.newsletterId) {
            const listIds = await this.findNewsletterListIds(
                request.newsletterId,
            );
            scoped = rows.filter((row) => listIds.has(row.list.id));
            // An ad-hoc recipient (or an unknown newsletter): there is no list
            // to leave, so the only way to stop the mail is everywhere.
            if (scoped.length === 0) {
                global = true;
                scoped = rows;
            }
        }

        const now = new Date();
        await this.dbTransactionService.execute(async (manager) => {
            await this.unsubscribeRows(manager, scoped, now);
            if (global) {
                await this.setSubscriberStatus(
                    manager,
                    subscriber,
                    SubscriberStatus.UNSUBSCRIBED,
                    UNSUBSCRIBED_EVERYWHERE_REASON,
                    now,
                );
            }
        });

        return {
            email: subscriber.email,
            unsubscribedLists: scoped
                .map((row) => row.list)
                .sort(byName)
                .map((list) => list.name),
            global,
        };
    }

    /** RFC 8058 one-click. Never throws on an unknown token. */
    async unsubscribeOneClick(
        token: string,
        newsletterId?: string,
    ): Promise<void> {
        if (!token) return;
        try {
            await this.unsubscribe({
                token,
                newsletterId: newsletterId || undefined,
            });
        } catch (error) {
            if (error instanceof NotFoundException) return;
            // Mail providers do not retry a one-click POST, so this is the
            // only trace of a request that should have worked.
            this.logger.error(
                `One-click unsubscribe failed: ${error?.message}`,
                error?.stack,
            );
        }
    }

    // --- Signed-in user ---

    /**
     * Mails the account's address the link to its preferences page. Nothing
     * checks that a user owns the email on their account, so the session alone
     * never reads or changes an address's lists: opening the link proves the
     * inbox. Resolves the same way whether or not an email went out; the
     * controller always answers with NEWSLETTER_PREFERENCES_LINK_MESSAGE.
     */
    async sendPreferencesLink(user: User): Promise<void> {
        const email = this.requireUserEmail(user);

        const claim = await this.dbTransactionService.execute(
            async (manager) => {
                // The page needs a token to link to. A new row is on no list
                // and an existing one is left as it is, so this subscribes
                // nobody and reactivates nothing. It carries no name either:
                // the account's name would otherwise greet whoever really
                // owns the address in later newsletters.
                await insertIgnoringConflicts(manager, Subscriber, [
                    { email, name: null, token: generateSubscriberToken() },
                ]);
                const subscriber = await manager.findOneOrFail(Subscriber, {
                    where: { email },
                    lock: { mode: 'pessimistic_write' },
                });
                return this.claimEmail(manager, subscriber);
            },
        );

        if (claim) {
            this.dispatch(claim, 'preferences link', () =>
                this.mailService.sendNewsletterPreferencesLinkEmail(
                    claim.email,
                    this.urlService.preferencesUrl(claim.token),
                ),
            );
        }
    }

    // --- Internals ---

    private async findAudienceSubscribers(
        listIds: string[],
        adHocEmails: string[],
    ): Promise<Subscriber[]> {
        const qb = this.subscriberRepository.createQueryBuilder('subscriber');
        const conditions: string[] = [];
        if (listIds.length > 0) {
            // EXISTS rather than a join, so an address on several of the
            // lists comes back once.
            const onLists = qb
                .subQuery()
                .select('1')
                .from(MailingListSubscription, 'subscription')
                .where('subscription.subscriber = subscriber.id')
                .andWhere('subscription.list IN (:...listIds)')
                .andWhere('subscription.status = :subscribed')
                .getQuery();
            conditions.push(`EXISTS ${onLists}`);
        }
        if (adHocEmails.length > 0) {
            conditions.push('subscriber.email IN (:...adHocEmails)');
        }
        return qb
            .where(`(${conditions.join(' OR ')})`, {
                listIds,
                adHocEmails,
                subscribed: SubscriptionStatus.SUBSCRIBED,
            })
            .orderBy('subscriber.email', 'ASC')
            .getMany();
    }

    /**
     * The database half of a public sign-up. Returns what to email, or null
     * when nothing needs confirming, a confirmation went out recently or the
     * daily cap is spent.
     */
    private async recordSignUp(
        manager: EntityManager,
        email: string,
        name: string | null,
        lists: MailingList[],
    ): Promise<PendingConfirmation | null> {
        // The typed name only ever lands on a row this request creates.
        // Anyone can type any address into the form, so an existing
        // subscriber's name (shown in every newsletter it gets) is never
        // touched, not even to fill in a missing one.
        await insertIgnoringConflicts(manager, Subscriber, [
            { email, name, token: generateSubscriberToken() },
        ]);
        // Locked so two sign-ups for one address cannot both decide to send.
        const subscriber = await manager.findOneOrFail(Subscriber, {
            where: { email },
            lock: { mode: 'pessimistic_write' },
        });

        const rows = await manager.find(MailingListSubscription, {
            where: {
                subscriber: { id: subscriber.id },
                list: { id: In(lists.map((list) => list.id)) },
            },
            relations: { list: true },
        });
        const listsWithRows = new Set(rows.map((row) => row.list.id));
        // A suppressed address is not mailed even on its SUBSCRIBED lists;
        // signing up again is how a bounced inbox gets back, so those need
        // confirming too.
        const reconfirm = subscriber.status !== SubscriberStatus.ACTIVE;
        const newLists = lists.filter((list) => !listsWithRows.has(list.id));
        const toPending = rows.filter(
            (row) =>
                row.status === SubscriptionStatus.UNSUBSCRIBED ||
                (row.status === SubscriptionStatus.SUBSCRIBED && reconfirm),
        );
        const alreadyPending = rows.some(
            (row) => row.status === SubscriptionStatus.PENDING,
        );
        if (
            newLists.length === 0 &&
            toPending.length === 0 &&
            !alreadyPending
        ) {
            return null;
        }

        await insertIgnoringConflicts(
            manager,
            MailingListSubscription,
            newLists.map((list) => ({
                list: { id: list.id },
                subscriber: { id: subscriber.id },
                status: SubscriptionStatus.PENDING,
                source: SubscriptionSource.PUBLIC_FORM,
            })),
        );
        if (toPending.length > 0) {
            // unsubscribedAt stays until confirmed: see hasOptedOut.
            await manager.update(
                MailingListSubscription,
                { id: In(toPending.map((row) => row.id)) },
                { status: SubscriptionStatus.PENDING },
            );
        }

        // The rows above stay recorded even when nothing is sent, so signing
        // up again later can still confirm them.
        const claim = await this.claimEmail(manager, subscriber);
        if (!claim) return null;

        // The link confirms every PENDING row, so the email names them all,
        // including ones from an earlier sign-up.
        const pending = await manager.find(MailingListSubscription, {
            where: {
                subscriber: { id: subscriber.id },
                status: SubscriptionStatus.PENDING,
            },
            relations: { list: true },
        });
        return {
            ...claim,
            listNames: pending
                .map((row) => row.list)
                .sort(byName)
                .map((list) => list.name),
        };
    }

    /**
     * Charges one confirmation or preferences-link email to the address by
     * stamping `lastConfirmationSentAt`, or returns null when the address had
     * one within the resend window or the daily cap is spent. The subscriber
     * must be locked, so two requests for one address cannot both send.
     */
    private async claimEmail(
        manager: EntityManager,
        subscriber: Subscriber,
    ): Promise<ClaimedEmail | null> {
        const now = new Date();
        const lastSent = subscriber.lastConfirmationSentAt;
        if (
            lastSent &&
            now.getTime() - lastSent.getTime() <
                NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS
        ) {
            return null;
        }
        if (await this.dailyCapReached(manager, now)) return null;

        await manager.update(
            Subscriber,
            { id: subscriber.id },
            { lastConfirmationSentAt: now },
        );
        return {
            subscriberId: subscriber.id,
            email: subscriber.email,
            token: subscriber.token,
            sentAt: now,
            previousSentAt: lastSent,
        };
    }

    /**
     * Counts addresses rather than emails: an address can be sent another
     * after the resend window without counting twice. Close enough for a
     * guard whose job is to stop a flood of fresh addresses.
     */
    private async dailyCapReached(
        manager: EntityManager,
        now: Date,
    ): Promise<boolean> {
        const sentToday = await manager.count(Subscriber, {
            where: {
                lastConfirmationSentAt: MoreThan(
                    new Date(now.getTime() - TWENTY_FOUR_HOURS_MS),
                ),
            },
        });
        if (sentToday < NEWSLETTER_CONFIRMATION_DAILY_CAP) return false;

        const message = `Newsletter confirmation and preferences-link emails hit the daily cap (${NEWSLETTER_CONFIRMATION_DAILY_CAP} addresses in 24h), so no more are being sent. Check the public subscribe form for abuse.`;
        this.logger.error(message);
        if (
            this.lastCapAlertAt === null ||
            now.getTime() - this.lastCapAlertAt >=
                NEWSLETTER_CONFIRMATION_CAP_ALERT_INTERVAL_MS
        ) {
            this.lastCapAlertAt = now.getTime();
            void this.discordAlert.sendErrorAlert(new ServiceError(message));
        }
        return true;
    }

    /** Sends a claimed email without waiting for SMTP. */
    private dispatch(
        claim: ClaimedEmail,
        kind: string,
        send: () => Promise<void>,
    ): void {
        void send().catch(async (error) => {
            this.logger.error(
                `Failed to send a newsletter ${kind} to subscriber ${claim.subscriberId}: ${error?.message}`,
                error?.stack,
            );
            // Let the address try again straight away instead of waiting out
            // the resend window for an email that never left, and stop it
            // counting against the daily cap.
            await this.subscriberRepository
                .update(
                    {
                        id: claim.subscriberId,
                        lastConfirmationSentAt: claim.sentAt,
                    },
                    { lastConfirmationSentAt: claim.previousSentAt },
                )
                .catch(() => undefined);
        });
    }

    /**
     * Public non-archived lists plus every list the address has a row on, and
     * those rows.
     */
    private async loadShownLists(subscriberId: string): Promise<{
        lists: MailingList[];
        rows: MailingListSubscription[];
    }> {
        const [publicLists, rows] = await Promise.all([
            this.listRepository.find({
                where: { isPublic: true, archivedAt: IsNull() },
            }),
            this.subscriptionRepository.find({
                where: { subscriber: { id: subscriberId } },
                relations: { list: true },
            }),
        ]);
        const lists = new Map(publicLists.map((list) => [list.id, list]));
        for (const row of rows) lists.set(row.list.id, row.list);
        return { lists: [...lists.values()].sort(byName), rows };
    }

    private async buildPreferences(
        subscriber: Subscriber,
    ): Promise<SubscriberPreferencesResponse> {
        const { lists, rows } = await this.loadShownLists(subscriber.id);
        const statusByList = new Map(
            rows.map((row) => [row.list.id, row.status]),
        );
        return {
            email: subscriber.email,
            name: subscriber.name,
            status: subscriber.status,
            lists: lists.map(
                (list) =>
                    new SubscriberPreferenceListDto(
                        list,
                        statusByList.get(list.id) ?? null,
                    ),
            ),
        };
    }

    /**
     * `subscribedListIds` is the whole desired set among the lists shown.
     * The token proves the address, so subscribing is immediate.
     */
    private async applyPreferences(
        subscriber: Subscriber,
        request: UpdatePreferencesRequest,
    ): Promise<void> {
        const { lists, rows } = await this.loadShownLists(subscriber.id);
        const now = new Date();

        if (request.unsubscribeAll) {
            await this.dbTransactionService.execute(async (manager) => {
                await this.unsubscribeRows(manager, rows, now);
                await this.setSubscriberStatus(
                    manager,
                    subscriber,
                    SubscriberStatus.UNSUBSCRIBED,
                    UNSUBSCRIBED_EVERYWHERE_REASON,
                    now,
                );
            });
            return;
        }

        const desired = new Set(request.subscribedListIds);
        const shown = new Set(lists.map((list) => list.id));
        if ([...desired].some((id) => !shown.has(id))) {
            throw new BadRequestException(
                'One or more of those lists is not open to subscription',
            );
        }

        const rowByList = new Map(rows.map((row) => [row.list.id, row]));
        const toInsert = [...desired].filter((id) => !rowByList.has(id));
        const toSubscribe = rows.filter(
            (row) =>
                desired.has(row.list.id) &&
                row.status !== SubscriptionStatus.SUBSCRIBED,
        );
        const toUnsubscribe = rows.filter((row) => !desired.has(row.list.id));

        await this.dbTransactionService.execute(async (manager) => {
            await insertIgnoringConflicts(
                manager,
                MailingListSubscription,
                toInsert.map((listId) => ({
                    list: { id: listId },
                    subscriber: { id: subscriber.id },
                    status: SubscriptionStatus.SUBSCRIBED,
                    source: SubscriptionSource.PUBLIC_FORM,
                    confirmedAt: now,
                })),
            );
            if (toSubscribe.length > 0) {
                await manager.update(
                    MailingListSubscription,
                    { id: In(toSubscribe.map((row) => row.id)) },
                    {
                        status: SubscriptionStatus.SUBSCRIBED,
                        confirmedAt: now,
                        unsubscribedAt: null,
                    },
                );
            }
            await this.unsubscribeRows(manager, toUnsubscribe, now);
            if (desired.size > 0) {
                await this.setSubscriberStatus(
                    manager,
                    subscriber,
                    SubscriberStatus.ACTIVE,
                    null,
                    now,
                );
            }
        });
    }

    /** Rows already UNSUBSCRIBED keep their original `unsubscribedAt`. */
    private async unsubscribeRows(
        manager: EntityManager,
        rows: MailingListSubscription[],
        now: Date,
    ): Promise<void> {
        const ids = rows
            .filter((row) => row.status !== SubscriptionStatus.UNSUBSCRIBED)
            .map((row) => row.id);
        if (ids.length === 0) return;
        await manager.update(
            MailingListSubscription,
            { id: In(ids) },
            { status: SubscriptionStatus.UNSUBSCRIBED, unsubscribedAt: now },
        );
    }

    private async setSubscriberStatus(
        manager: EntityManager,
        subscriber: Subscriber,
        status: SubscriberStatus,
        reason: string | null,
        now: Date,
    ): Promise<void> {
        if (subscriber.status === status) return;
        await manager.update(
            Subscriber,
            { id: subscriber.id },
            { status, statusReason: reason, statusChangedAt: now },
        );
    }

    private async findNewsletterListIds(
        newsletterId: string,
    ): Promise<Set<string>> {
        // The id arrives from a link; a malformed one would be a query error.
        if (!isUUID(newsletterId)) return new Set();
        const newsletter = await this.newsletterRepository.findOne({
            where: { id: newsletterId },
            relations: { lists: true },
        });
        return new Set(newsletter?.lists.map((list) => list.id) ?? []);
    }

    private async findByTokenOrFail(token: string): Promise<Subscriber> {
        const subscriber = token
            ? await this.subscriberRepository.findOne({ where: { token } })
            : null;
        if (!subscriber) {
            throw new NotFoundException('This link is no longer valid');
        }
        return subscriber;
    }

    private requireUserEmail(user: User): string {
        const email = user.email ? normalizeEmail(user.email) : '';
        if (!email) {
            throw new BadRequestException(
                'Add an email address to your profile to manage newsletters',
            );
        }
        return email;
    }
}
