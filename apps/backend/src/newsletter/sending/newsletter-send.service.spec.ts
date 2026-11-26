import { ConfigService } from '@nestjs/config';
import { APITask } from '@/entities/api-task.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import {
    NewsletterContentFormat,
    NewsletterDeliveryStatus,
    NewsletterStatus,
    SubscriberStatus,
} from '@/common/enum';
import { TaskType } from '@/task-processor/task.enums';
import {
    NEWSLETTER_STALE_CLAIM_MS,
    NEWSLETTER_STALL_THRESHOLD_MS,
    NEWSLETTER_THROTTLE_PAUSE_MS,
} from '@/newsletter/newsletter.constants';
import { NewsletterSendService } from '@/newsletter/sending/newsletter-send.service';
import {
    AudienceSnapshot,
    ClaimedDelivery,
    NewsletterSendStore,
} from '@/newsletter/sending/newsletter-send.store';
import { NewsletterRenderService } from '@/newsletter/rendering/newsletter-render.service';
import { NewsletterMailerService } from '@/newsletter/sending/newsletter-mailer.service';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';
import { extractTrackableLinks } from '@/newsletter/tracking/newsletter-tracking.util';

// See newsletter-render.service.spec.ts: juice is ESM-only.
jest.mock('juice', () =>
    process.getBuiltinModule('module').createRequire(__filename)('juice'),
);
jest.mock('@/newsletter/tracking/newsletter-tracking.util', () => ({
    applyTracking: jest.fn((html: string) => html),
    extractTrackableLinks: jest.fn(() => []),
}));

const D = NewsletterDeliveryStatus;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
    id: string;
    email: string;
    name: string | null;
    subscriberId: string | null;
    status: NewsletterDeliveryStatus;
    attempts: number;
    error: string | null;
    claimedAt: Date | null;
    sentAt: Date | null;
    seq: number;
}

/**
 * The store's contract, in memory. Each method does what the SQL in
 * NewsletterSendStore does, so the send loop can be exercised end to end.
 */
class FakeStore {
    newsletter: Newsletter;
    rows: Row[] = [];
    tasks: { newsletterId: string; executeOnTime: Date }[] = [];
    /** sentAt of other newsletters' emails, for the daily limit. */
    sentElsewhere: Date[] = [];
    /** claimedAt of other newsletters' deliveries in flight. */
    inFlightElsewhere: Date[] = [];
    subscribers = new Map<
        string,
        { token: string; status: SubscriberStatus }
    >();
    /** Subscriber id -> ids of the lists it is SUBSCRIBED on. */
    subscribedLists = new Map<string, Set<string>>();
    private seq = 0;

    constructor(newsletter: Newsletter) {
        this.newsletter = newsletter;
    }

    // --- Test helpers ---

    status(email: string): NewsletterDeliveryStatus | undefined {
        return this.rows.find((row) => row.email === email)?.status;
    }

    row(email: string): Row {
        const row = this.rows.find((r) => r.email === email);
        if (!row) throw new Error(`no row for ${email}`);
        return row;
    }

    addRow(
        email: string,
        subscriberId: string,
        status: NewsletterDeliveryStatus,
    ): void {
        const row = this.newRow(email, null, subscriberId, status);
        if (status === D.SENDING) row.claimedAt = new Date();
        this.rows.push(row);
    }

    setSubscriberStatus(subscriberId: string, status: SubscriberStatus): void {
        const subscriber = this.subscribers.get(subscriberId);
        if (subscriber) subscriber.status = status;
    }

    subscribe(subscriberId: string, listId: string): void {
        const lists = this.subscribedLists.get(subscriberId) ?? new Set();
        lists.add(listId);
        this.subscribedLists.set(subscriberId, lists);
    }

    unsubscribe(subscriberId: string, listId: string): void {
        this.subscribedLists.get(subscriberId)?.delete(listId);
    }

    /** Erasure: the FK's ON DELETE SET NULL clears it off its deliveries. */
    deleteSubscriber(subscriberId: string): void {
        this.subscribers.delete(subscriberId);
        this.subscribedLists.delete(subscriberId);
        for (const row of this.rows) {
            if (row.subscriberId === subscriberId) row.subscriberId = null;
        }
    }

    /** What NewslettersService.cancel does. */
    cancel(): void {
        this.newsletter.status = NewsletterStatus.CANCELLED;
        for (const row of this.rows) {
            if (row.status === D.PENDING || row.status === D.SENDING) {
                row.status = D.SKIPPED;
                row.error = 'Cancelled';
                row.claimedAt = null;
            }
        }
    }

    // --- NewsletterSendStore ---

    async findNewsletter(id: string): Promise<Newsletter | null> {
        return id === this.newsletter.id ? { ...this.newsletter } : null;
    }

    async startScheduled(_id: string, now: Date): Promise<boolean> {
        const n = this.newsletter;
        if (
            n.status !== NewsletterStatus.SCHEDULED ||
            !n.scheduledAt ||
            n.scheduledAt > now
        ) {
            return false;
        }
        n.status = NewsletterStatus.SENDING;
        n.lastProgressAt = now;
        return true;
    }

    async snapshotAudience(
        _id: string,
        now: Date,
        prepare: () => Promise<AudienceSnapshot>,
    ): Promise<boolean> {
        if (this.newsletter.status !== NewsletterStatus.SENDING) return false;
        if (this.newsletter.sendStartedAt) return true;
        const snapshot = await prepare();
        for (const recipient of snapshot.recipients) {
            if (this.rows.some((r) => r.email === recipient.email)) continue;
            this.rows.push(
                this.newRow(
                    recipient.email,
                    recipient.name,
                    recipient.subscriberId,
                    D.PENDING,
                ),
            );
        }
        for (const skipped of snapshot.skipped) {
            if (this.rows.some((r) => r.email === skipped.email)) continue;
            const row = this.newRow(skipped.email, null, null, D.SKIPPED);
            row.error = skipped.reason;
            this.rows.push(row);
        }
        this.newsletter.totalRecipients = this.rows.length;
        this.newsletter.trackedLinks = snapshot.trackedLinks;
        this.newsletter.sendStartedAt = now;
        this.newsletter.lastProgressAt = now;
        return true;
    }

    async skipSuppressed(): Promise<void> {
        for (const row of this.rows) {
            if (row.status !== D.PENDING || this.stillWanted(row)) continue;
            Object.assign(row, {
                status: D.SKIPPED,
                claimedAt: null,
                error: this.suppressedReason(row),
            });
        }
    }

    async countSentSince(since: Date): Promise<number> {
        return this.sentTimes().filter((t) => t > since.getTime()).length;
    }

    async countSentOrInFlight(
        since: Date,
        claimedSince: Date,
    ): Promise<number> {
        const fresh = (claimedAt: Date | null) =>
            !!claimedAt && claimedAt >= claimedSince;
        const inFlightHere =
            this.newsletter.status === NewsletterStatus.SENDING
                ? this.rows.filter(
                      (r) => r.status === D.SENDING && fresh(r.claimedAt),
                  ).length
                : 0;
        return (
            (await this.countSentSince(since)) +
            inFlightHere +
            this.inFlightElsewhere.filter(fresh).length
        );
    }

    async sentAtAtOffset(since: Date, offset: number): Promise<Date | null> {
        const times = this.sentTimes()
            .filter((t) => t > since.getTime())
            .sort((a, b) => a - b);
        return times[offset] !== undefined ? new Date(times[offset]) : null;
    }

    async claimBatch(
        _id: string,
        size: number,
        claimedAt: Date,
    ): Promise<ClaimedDelivery[] | null> {
        if (this.newsletter.status !== NewsletterStatus.SENDING) return null;
        if (this.rows.some((r) => r.status === D.SENDING)) return null;
        const claimed = this.rows
            .filter((r) => r.status === D.PENDING)
            .sort((a, b) => a.attempts - b.attempts || a.seq - b.seq)
            .slice(0, size);
        for (const row of claimed) {
            row.status = D.SENDING;
            row.claimedAt = claimedAt;
        }
        return claimed.map((row) => ({
            id: row.id,
            email: row.email,
            name: row.name,
            attempts: row.attempts,
            subscriberId: row.subscriberId,
            token: row.subscriberId
                ? (this.subscribers.get(row.subscriberId)?.token ?? null)
                : null,
        }));
    }

    async reconfirmClaim(
        _id: string,
        deliveryId: string,
        claimedAt: Date,
        touchedAt: Date,
    ): Promise<boolean> {
        const row = this.byId(deliveryId);
        const n = this.newsletter;
        if (
            row.status !== D.SENDING ||
            row.claimedAt?.getTime() !== claimedAt.getTime() ||
            n.status !== NewsletterStatus.SENDING ||
            (n.pausedUntil && n.pausedUntil > touchedAt)
        ) {
            return false;
        }
        row.claimedAt = touchedAt;
        return true;
    }

    async skipIfUnwanted(
        _id: string,
        deliveryId: string,
        claimedAt: Date,
    ): Promise<boolean> {
        const row = this.byId(deliveryId);
        if (!this.heldUnder(row, claimedAt) || this.stillWanted(row)) {
            return false;
        }
        Object.assign(row, {
            status: D.SKIPPED,
            claimedAt: null,
            error: this.suppressedReason(row),
        });
        return true;
    }

    async isSending(_id: string, now: Date): Promise<boolean> {
        const n = this.newsletter;
        return (
            n.status === NewsletterStatus.SENDING &&
            !(n.pausedUntil && n.pausedUntil > now)
        );
    }

    async markSent(deliveryId: string, sentAt: Date): Promise<void> {
        Object.assign(this.byId(deliveryId), {
            status: D.SENT,
            sentAt,
            claimedAt: null,
            error: null,
        });
    }

    async markFailed(
        deliveryId: string,
        claimedAt: Date,
        attempts: number,
        error: string,
    ): Promise<void> {
        const row = this.byId(deliveryId);
        if (!this.heldUnder(row, claimedAt)) return;
        Object.assign(row, {
            status: D.FAILED,
            attempts,
            error,
            claimedAt: null,
        });
    }

    async markForRetry(
        deliveryId: string,
        claimedAt: Date,
        attempts: number,
        error: string,
    ): Promise<void> {
        const row = this.byId(deliveryId);
        if (!this.heldUnder(row, claimedAt)) return;
        Object.assign(row, {
            status: D.PENDING,
            attempts,
            error,
            claimedAt: null,
        });
    }

    async releaseClaims(ids: string[], claimedAt: Date): Promise<void> {
        for (const id of ids) {
            const row = this.byId(id);
            if (this.heldUnder(row, claimedAt)) {
                row.status = D.PENDING;
                row.claimedAt = null;
            }
        }
    }

    async pause(
        id: string,
        until: Date,
        reason: string,
        now: Date,
    ): Promise<void> {
        if (this.newsletter.status !== NewsletterStatus.SENDING) return;
        Object.assign(this.newsletter, {
            pausedUntil: until,
            pauseReason: reason,
            lastProgressAt: now,
        });
        await this.enqueue(id, until);
    }

    async clearPause(): Promise<void> {
        this.newsletter.pausedUntil = null;
        this.newsletter.pauseReason = null;
    }

    async touchProgress(_id: string, now: Date): Promise<void> {
        this.newsletter.lastProgressAt = now;
    }

    async countPending(): Promise<number> {
        return this.rows.filter((r) => r.status === D.PENDING).length;
    }

    async complete(_id: string, now: Date): Promise<boolean> {
        if (
            this.newsletter.status !== NewsletterStatus.SENDING ||
            this.rows.some(
                (r) => r.status === D.PENDING || r.status === D.SENDING,
            )
        ) {
            return false;
        }
        Object.assign(this.newsletter, {
            status: NewsletterStatus.SENT,
            sentAt: now,
            pausedUntil: null,
            pauseReason: null,
        });
        return true;
    }

    async enqueue(newsletterId: string, executeOnTime: Date): Promise<void> {
        this.tasks.push({ newsletterId, executeOnTime });
    }

    releaseStaleClaims = jest.fn(async () => 0);
    requeueStalled = jest.fn(async (): Promise<string[]> => []);

    private newRow(
        email: string,
        name: string | null,
        subscriberId: string | null,
        status: NewsletterDeliveryStatus,
    ): Row {
        this.seq++;
        return {
            id: `d-${this.seq}`,
            email,
            name,
            subscriberId,
            status,
            attempts: 0,
            error: null,
            claimedAt: null,
            sentAt: null,
            seq: this.seq,
        };
    }

    private byId(id: string): Row {
        const row = this.rows.find((r) => r.id === id);
        if (!row) throw new Error(`no row ${id}`);
        return row;
    }

    /** DELIVERY_STILL_WANTED_SQL. */
    private stillWanted(row: Row): boolean {
        const subscriber = row.subscriberId
            ? this.subscribers.get(row.subscriberId)
            : undefined;
        if (subscriber?.status !== SubscriberStatus.ACTIVE) return false;
        const { lists, adHocEmails } = this.newsletter;
        if (lists.length === 0) return true;
        const subscribed = this.subscribedLists.get(row.subscriberId ?? '');
        return (
            lists.some((list) => subscribed?.has(list.id)) ||
            adHocEmails.some(
                (email) => email.toLowerCase() === row.email.toLowerCase(),
            )
        );
    }

    /** SUPPRESSED_REASON_SQL, abbreviated. */
    private suppressedReason(row: Row): string {
        const subscriber = row.subscriberId
            ? this.subscribers.get(row.subscriberId)
            : undefined;
        if (!subscriber) return 'erased';
        return subscriber.status === SubscriberStatus.ACTIVE
            ? 'off the lists'
            : subscriber.status;
    }

    private heldUnder(row: Row, claimedAt: Date): boolean {
        return (
            row.status === D.SENDING &&
            row.claimedAt?.getTime() === claimedAt.getTime()
        );
    }

    private sentTimes(): number[] {
        return [
            ...this.sentElsewhere.map((d) => d.getTime()),
            ...this.rows
                .filter((r) => r.sentAt)
                .map((r) => (r.sentAt as Date).getTime()),
        ];
    }
}

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
    return {
        id: 'nl-1',
        subject: 'Hello',
        preheader: null,
        contentFormat: NewsletterContentFormat.RICH_TEXT,
        content: '<p>Hi</p>',
        replyTo: null,
        status: NewsletterStatus.SENDING,
        lists: [{ id: 'list-1', slug: 'updates', name: 'Updates' }],
        adHocEmails: [],
        trackingEnabled: false,
        trackedLinks: [],
        totalRecipients: 0,
        scheduledAt: null,
        sendStartedAt: null,
        sentAt: null,
        cancelledAt: null,
        pausedUntil: null,
        lastProgressAt: null,
        pauseReason: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as Newsletter;
}

function smtpError(response: string, command = 'RCPT TO'): Error {
    return Object.assign(new Error(response), {
        code: 'EENVELOPE',
        command,
        response,
        responseCode: Number(response.slice(0, 3)),
    });
}

const task = {
    data: { newsletterId: 'nl-1' },
} as APITask<TaskType.SEND_NEWSLETTER>;

describe('NewsletterSendService', () => {
    let store: FakeStore;
    let service: NewsletterSendService;
    let config: Record<string, unknown>;
    const subscriptionService = {
        resolveAudience: jest.fn(),
        markBounced: jest.fn(),
    };
    const renderService = {
        render: jest.fn(),
        buildTemplate: jest.fn(() => '<a href="https://bitshala.org">x</a>'),
    };
    const mailer = { send: jest.fn() };
    const sleep = jest.fn(async () => undefined);

    function build(): void {
        const configService = {
            get: (key: string) => config[key],
        } as unknown as ConfigService;
        service = new NewsletterSendService(
            store as unknown as NewsletterSendStore,
            subscriptionService as unknown as SubscriptionService,
            renderService as unknown as NewsletterRenderService,
            mailer as unknown as NewsletterMailerService,
            configService,
        );
        service.sleep = sleep;
    }

    /**
     * Audience of `count` ACTIVE subscribers, a0@x.test, a1@x.test, ...,
     * SUBSCRIBED on list-1, plus any `extra` recipients as given.
     */
    function audience(
        count: number,
        skipped: string[] = [],
        extra: { subscriberId: string; email: string; name: string }[] = [],
    ): void {
        const recipients = Array.from({ length: count }, (_, i) => ({
            subscriberId: `s-${i}`,
            email: `a${i}@x.test`,
            name: `A${i}`,
        }));
        for (const r of recipients) store.subscribe(r.subscriberId, 'list-1');
        recipients.push(...extra);
        for (const r of recipients) {
            store.subscribers.set(r.subscriberId, {
                token: `tok-${r.subscriberId}`,
                status: SubscriberStatus.ACTIVE,
            });
        }
        subscriptionService.resolveAudience.mockResolvedValue({
            recipients,
            skipped: skipped.map((email) => ({
                email,
                reason: 'Unsubscribed',
            })),
            invalid: [],
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        config = {
            'email.newsletter.dailyLimit': 1500,
            'email.newsletter.ratePerMinute': 30,
        };
        store = new FakeStore(makeNewsletter());
        renderService.render.mockImplementation(
            (newsletter: Newsletter, recipient: { email: string }) => ({
                subject: newsletter.subject,
                html: `<p>${recipient.email}</p>`,
                text: recipient.email,
                headers: { Precedence: 'bulk' },
            }),
        );
        mailer.send.mockResolvedValue(undefined);
        build();
    });

    it('does nothing for a scheduled newsletter that is not due yet', async () => {
        store.newsletter = makeNewsletter({
            status: NewsletterStatus.SCHEDULED,
            scheduledAt: new Date(Date.now() + 60_000),
        });
        audience(2);

        await service.handleSendNewsletter(task);

        expect(store.newsletter.status).toBe(NewsletterStatus.SCHEDULED);
        expect(subscriptionService.resolveAudience).not.toHaveBeenCalled();
        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.tasks).toEqual([]);
    });

    it('starts a scheduled newsletter once due, and sends it', async () => {
        store.newsletter = makeNewsletter({
            status: NewsletterStatus.SCHEDULED,
            scheduledAt: new Date(Date.now() - 1000),
        });
        audience(2);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(2);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it.each([
        NewsletterStatus.DRAFT,
        NewsletterStatus.SENT,
        NewsletterStatus.CANCELLED,
    ])('returns quietly for a %s newsletter', async (status) => {
        store.newsletter = makeNewsletter({ status });
        audience(2);

        await service.handleSendNewsletter(task);

        expect(subscriptionService.resolveAudience).not.toHaveBeenCalled();
        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.tasks).toEqual([]);
    });

    it('returns quietly while paused into the future', async () => {
        store.newsletter = makeNewsletter({
            pausedUntil: new Date(Date.now() + 60_000),
        });
        audience(2);

        await service.handleSendNewsletter(task);

        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.tasks).toEqual([]);
    });

    it('snapshots the audience once, skipping suppressed addresses', async () => {
        store.newsletter = makeNewsletter({
            trackingEnabled: true,
            adHocEmails: ['adhoc@x.test'],
        });
        (extractTrackableLinks as jest.Mock).mockReturnValue([
            'https://bitshala.org',
        ]);
        audience(3, ['gone@x.test']);

        await service.handleSendNewsletter(task);
        await service.handleSendNewsletter(task);

        expect(subscriptionService.resolveAudience).toHaveBeenCalledTimes(1);
        expect(subscriptionService.resolveAudience).toHaveBeenCalledWith(
            ['list-1'],
            ['adhoc@x.test'],
        );
        expect(store.rows).toHaveLength(4);
        expect(store.row('gone@x.test')).toMatchObject({
            status: D.SKIPPED,
            error: 'Unsubscribed',
        });
        expect(store.newsletter.totalRecipients).toBe(4);
        expect(store.newsletter.trackedLinks).toEqual(['https://bitshala.org']);
        expect(mailer.send).toHaveBeenCalledTimes(3);
    });

    it('sends a whole batch paced, then marks the newsletter SENT', async () => {
        audience(3);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(3);
        expect(mailer.send).toHaveBeenCalledWith({
            to: 'a0@x.test',
            toName: 'A0',
            subject: 'Hello',
            html: '<p>a0@x.test</p>',
            text: 'a0@x.test',
            headers: { Precedence: 'bulk' },
            replyTo: null,
        });
        expect(renderService.render).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'nl-1' }),
            { email: 'a0@x.test', name: 'A0', token: 'tok-s-0' },
            { mode: 'send', deliveryId: 'd-1' },
        );
        // 30 per minute: two seconds between emails, none before the first.
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(2000);
        expect(store.rows.every((r) => r.status === D.SENT)).toBe(true);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        expect(store.newsletter.sentAt).toBeInstanceOf(Date);
        expect(store.tasks).toEqual([]);
    });

    it('sends 25 per run and queues the next run', async () => {
        audience(30);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(25);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENDING);
        expect(store.tasks).toHaveLength(1);
        expect(store.tasks[0].executeOnTime.getTime()).toBeGreaterThan(
            Date.now(),
        );

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(30);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it('sends smaller batches at a slow pace, inside the stale-claim window', async () => {
        config['email.newsletter.ratePerMinute'] = 1;
        build();
        audience(10);

        await service.handleSendNewsletter(task);

        // One a minute: five minutes is a third of the 15-minute window.
        expect(mailer.send).toHaveBeenCalledTimes(5);
        expect(sleep).toHaveBeenCalledWith(60_000);
    });

    it('pauses until enough of the window ages out when the daily limit is used up', async () => {
        config['email.newsletter.dailyLimit'] = 30;
        build();
        const now = Date.now();
        // 30 sends spread over the last 24h, oldest first.
        store.sentElsewhere = Array.from(
            { length: 30 },
            (_, i) => new Date(now - DAY_MS + (i + 1) * 60_000),
        );
        audience(3);

        await service.handleSendNewsletter(task);

        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.rows.every((r) => r.status === D.PENDING)).toBe(true);
        const { pausedUntil, pauseReason } = store.newsletter;
        // A full batch (25) must age out: the 25th oldest, 24h on, plus a
        // minute's margin.
        expect(pausedUntil?.getTime()).toBe(
            store.sentElsewhere[24].getTime() + DAY_MS + 60_000,
        );
        expect(pauseReason).toMatch(
            /limit of 30 newsletter emails per 24 hours/,
        );
        expect(store.tasks).toEqual([
            { newsletterId: 'nl-1', executeOnTime: pausedUntil },
        ]);
    });

    it('sends only what the daily budget allows', async () => {
        config['email.newsletter.dailyLimit'] = 5;
        build();
        store.sentElsewhere = [new Date(), new Date(), new Date()];
        audience(4);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(2);
        expect(store.tasks).toHaveLength(1);
    });

    it("counts other newsletters' batches in flight as spent", async () => {
        config['email.newsletter.dailyLimit'] = 30;
        build();
        store.sentElsewhere = [new Date(), new Date(), new Date()];
        // Another newsletter claimed 25 a moment ago and is sending them.
        store.inFlightElsewhere = Array.from({ length: 25 }, () => new Date());
        audience(4);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(2);
        expect(store.tasks).toHaveLength(1);
    });

    it('does not count a stale claim, which stall recovery will release', async () => {
        config['email.newsletter.dailyLimit'] = 30;
        build();
        store.inFlightElsewhere = Array.from(
            { length: 25 },
            () => new Date(Date.now() - NEWSLETTER_STALE_CLAIM_MS - 60_000),
        );
        audience(4);

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(4);
    });

    it('pauses when batches in flight use up what the daily limit has left', async () => {
        config['email.newsletter.dailyLimit'] = 30;
        build();
        const now = Date.now();
        store.sentElsewhere = Array.from(
            { length: 5 },
            (_, i) => new Date(now - DAY_MS + (i + 1) * 60_000),
        );
        store.inFlightElsewhere = Array.from({ length: 25 }, () => new Date());
        audience(3);

        await service.handleSendNewsletter(task);

        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.rows.every((r) => r.status === D.PENDING)).toBe(true);
        // A full batch has to age out and only five sends can: wait for the
        // newest of them.
        expect(store.newsletter.pausedUntil?.getTime()).toBe(
            store.sentElsewhere[4].getTime() + DAY_MS + 60_000,
        );
        expect(store.newsletter.pauseReason).toMatch(/limit of 30/);
    });

    it('on a throttle mid-batch, puts the rest back and pauses', async () => {
        audience(4);
        mailer.send
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(
                smtpError('421 4.7.0 Try again later, closing connection.'),
            );

        const before = Date.now();
        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(2);
        expect(store.status('a0@x.test')).toBe(D.SENT);
        for (const email of ['a1@x.test', 'a2@x.test', 'a3@x.test']) {
            // No attempt spent, nothing failed.
            expect(store.row(email)).toMatchObject({
                status: D.PENDING,
                attempts: 0,
                claimedAt: null,
            });
        }
        const pausedUntil = store.newsletter.pausedUntil?.getTime() ?? 0;
        expect(pausedUntil).toBeGreaterThanOrEqual(
            before + NEWSLETTER_THROTTLE_PAUSE_MS,
        );
        expect(store.newsletter.pauseReason).toMatch(
            /throttling sends.*421 4\.7\.0 Try again later/,
        );
        expect(store.newsletter.status).toBe(NewsletterStatus.SENDING);
        expect(store.tasks).toEqual([
            {
                newsletterId: 'nl-1',
                executeOnTime: store.newsletter.pausedUntil,
            },
        ]);
    });

    it('resumes after the pause and clears it', async () => {
        audience(2);
        store.newsletter.pausedUntil = new Date(Date.now() - 1000);
        store.newsletter.pauseReason = 'Throttled';

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(2);
        expect(store.newsletter.pausedUntil).toBeNull();
        expect(store.newsletter.pauseReason).toBeNull();
    });

    it('marks a bounce FAILED and suppresses the address', async () => {
        audience(3);
        mailer.send
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(
                smtpError(
                    '550 5.1.1 The email account that you tried to reach does not exist.',
                ),
            );

        await service.handleSendNewsletter(task);

        expect(store.row('a1@x.test')).toMatchObject({
            status: D.FAILED,
            attempts: 1,
            error: '550 5.1.1 The email account that you tried to reach does not exist.',
        });
        expect(subscriptionService.markBounced).toHaveBeenCalledWith(
            's-1',
            '550 5.1.1 The email account that you tried to reach does not exist.',
        );
        expect(store.status('a0@x.test')).toBe(D.SENT);
        expect(store.status('a2@x.test')).toBe(D.SENT);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it('retries other failures up to the attempt limit, then FAILED', async () => {
        audience(2);
        mailer.send.mockImplementation(async ({ to }: { to: string }) => {
            if (to === 'a0@x.test') throw new Error('Message rejected');
        });

        await service.handleSendNewsletter(task);
        expect(store.row('a0@x.test')).toMatchObject({
            status: D.PENDING,
            attempts: 1,
            error: 'Message rejected',
        });
        expect(store.status('a1@x.test')).toBe(D.SENT);
        expect(store.tasks).toHaveLength(1);

        await service.handleSendNewsletter(task);
        expect(store.row('a0@x.test')).toMatchObject({
            status: D.PENDING,
            attempts: 2,
        });

        await service.handleSendNewsletter(task);
        expect(store.row('a0@x.test')).toMatchObject({
            status: D.FAILED,
            attempts: 3,
        });
        expect(subscriptionService.markBounced).not.toHaveBeenCalled();
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        expect(
            mailer.send.mock.calls.filter(([m]) => m.to === 'a0@x.test'),
        ).toHaveLength(3);
    });

    it('stops a running batch when the newsletter is cancelled', async () => {
        audience(4);
        mailer.send.mockImplementationOnce(async () => {
            // The admin cancels while the first email is on the wire.
            store.cancel();
        });

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(1);
        // It went out, so it says so.
        expect(store.status('a0@x.test')).toBe(D.SENT);
        for (const email of ['a1@x.test', 'a2@x.test', 'a3@x.test']) {
            expect(store.row(email)).toMatchObject({
                status: D.SKIPPED,
                error: 'Cancelled',
            });
        }
        expect(store.newsletter.status).toBe(NewsletterStatus.CANCELLED);
        expect(store.tasks).toEqual([]);
    });

    it('hands back the whole unsent rest of a batch, current row included, when paused under it', async () => {
        audience(4);
        mailer.send.mockImplementationOnce(async () => {
            // Paused while the first email is on the wire.
            store.newsletter.pausedUntil = new Date(Date.now() + 60_000);
        });

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(1);
        expect(store.status('a0@x.test')).toBe(D.SENT);
        for (const email of ['a1@x.test', 'a2@x.test', 'a3@x.test']) {
            expect(store.row(email)).toMatchObject({
                status: D.PENDING,
                attempts: 0,
                claimedAt: null,
            });
        }

        // Nothing is left looking in flight, so the resume can claim at
        // once instead of waiting for stall recovery.
        store.newsletter.pausedUntil = new Date(Date.now() - 1000);
        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(4);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it('leaves a newsletter alone while another run has a batch in flight', async () => {
        audience(2);
        store.newsletter.sendStartedAt = new Date();
        store.addRow('a0@x.test', 's-0', D.SENDING);
        store.addRow('a1@x.test', 's-1', D.PENDING);

        await service.handleSendNewsletter(task);

        expect(mailer.send).not.toHaveBeenCalled();
        expect(store.status('a1@x.test')).toBe(D.PENDING);
        expect(store.tasks).toEqual([]);
    });

    it('skips addresses that unsubscribed after the snapshot', async () => {
        audience(30);
        await service.handleSendNewsletter(task);
        store.setSubscriberStatus('s-27', SubscriberStatus.UNSUBSCRIBED);

        await service.handleSendNewsletter(task);

        expect(store.status('a27@x.test')).toBe(D.SKIPPED);
        expect(
            mailer.send.mock.calls.some(([m]) => m.to === 'a27@x.test'),
        ).toBe(false);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it("skips addresses that left the newsletter's lists after the snapshot", async () => {
        audience(30);
        await service.handleSendNewsletter(task);
        // Still ACTIVE globally: they only left this list.
        store.unsubscribe('s-27', 'list-1');

        await service.handleSendNewsletter(task);

        expect(store.row('a27@x.test')).toMatchObject({
            status: D.SKIPPED,
            error: 'off the lists',
        });
        expect(
            mailer.send.mock.calls.some(([m]) => m.to === 'a27@x.test'),
        ).toBe(false);
        expect(store.status('a28@x.test')).toBe(D.SENT);
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    it('keeps sending to an address on another of its lists', async () => {
        store.newsletter = makeNewsletter({
            lists: [
                { id: 'list-1', slug: 'updates', name: 'Updates' },
                { id: 'list-2', slug: 'events', name: 'Events' },
            ] as Newsletter['lists'],
        });
        audience(30);
        store.subscribe('s-27', 'list-2');
        await service.handleSendNewsletter(task);
        store.unsubscribe('s-27', 'list-1');

        await service.handleSendNewsletter(task);

        expect(store.status('a27@x.test')).toBe(D.SENT);
    });

    it('keeps sending to an ad-hoc recipient who is on none of its lists', async () => {
        store.newsletter = makeNewsletter({ adHocEmails: ['Guest@X.test'] });
        audience(
            1,
            [],
            [{ subscriberId: 's-guest', email: 'guest@x.test', name: 'Guest' }],
        );

        await service.handleSendNewsletter(task);

        expect(store.status('a0@x.test')).toBe(D.SENT);
        expect(store.status('guest@x.test')).toBe(D.SENT);
    });

    it('applies only the global status to a newsletter with no lists', async () => {
        store.newsletter = makeNewsletter({ lists: [] });
        // On no list at all, and not even listed as ad hoc in the fake.
        audience(
            0,
            [],
            Array.from({ length: 30 }, (_, i) => ({
                subscriberId: `s-b${i}`,
                email: `b${i}@x.test`,
                name: `B${i}`,
            })),
        );
        await service.handleSendNewsletter(task);
        store.setSubscriberStatus('s-b27', SubscriberStatus.UNSUBSCRIBED);

        await service.handleSendNewsletter(task);

        expect(store.status('b26@x.test')).toBe(D.SENT);
        expect(store.row('b27@x.test')).toMatchObject({
            status: D.SKIPPED,
            error: SubscriberStatus.UNSUBSCRIBED,
        });
        expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
    });

    describe('when a recipient stops wanting it after the claim', () => {
        beforeEach(() => {
            jest.useFakeTimers({
                doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
            });
            // Waiting between emails moves the clock on, as it does for
            // real, so every row after the first is reconfirmed under a later
            // time than the batch's claim. A check made under the original
            // claim time would then find nothing and let the email go out.
            service.sleep = async (ms) => {
                jest.setSystemTime(Date.now() + ms);
            };
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        /** Runs `change` while the email to `to` is on the wire. */
        function whileSending(to: string, change: () => void): void {
            mailer.send.mockImplementation(async (message: { to: string }) => {
                if (message.to === to) change();
            });
        }

        function mailedTo(email: string): boolean {
            return mailer.send.mock.calls.some(([m]) => m.to === email);
        }

        it('skips a recipient who unsubscribes from everything mid-batch', async () => {
            audience(3);
            whileSending('a0@x.test', () =>
                store.setSubscriberStatus('s-1', SubscriberStatus.UNSUBSCRIBED),
            );

            await service.handleSendNewsletter(task);

            expect(mailedTo('a1@x.test')).toBe(false);
            expect(mailer.send).toHaveBeenCalledTimes(2);
            expect(store.row('a1@x.test')).toMatchObject({
                status: D.SKIPPED,
                claimedAt: null,
                attempts: 0,
                error: SubscriberStatus.UNSUBSCRIBED,
            });
            expect(store.status('a0@x.test')).toBe(D.SENT);
            expect(store.status('a2@x.test')).toBe(D.SENT);
            // Finished in this run: nothing left behind for a later one.
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
            expect(store.tasks).toEqual([]);
        });

        it("skips a recipient who leaves the newsletter's lists mid-batch", async () => {
            audience(3);
            // Still ACTIVE globally: they only left this list.
            whileSending('a0@x.test', () => store.unsubscribe('s-1', 'list-1'));

            await service.handleSendNewsletter(task);

            expect(mailedTo('a1@x.test')).toBe(false);
            expect(store.row('a1@x.test')).toMatchObject({
                status: D.SKIPPED,
                error: 'off the lists',
            });
            expect(store.status('a2@x.test')).toBe(D.SENT);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        });

        it('skips a recipient deleted mid-batch', async () => {
            audience(3);
            whileSending('a0@x.test', () => store.deleteSubscriber('s-1'));

            await service.handleSendNewsletter(task);

            expect(mailedTo('a1@x.test')).toBe(false);
            expect(store.row('a1@x.test')).toMatchObject({
                status: D.SKIPPED,
                subscriberId: null,
                error: 'erased',
            });
            expect(store.status('a2@x.test')).toBe(D.SENT);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        });

        it('skips a recipient bounced by another newsletter mid-batch', async () => {
            audience(3);
            whileSending('a0@x.test', () =>
                store.setSubscriberStatus('s-1', SubscriberStatus.BOUNCED),
            );

            await service.handleSendNewsletter(task);

            expect(mailedTo('a1@x.test')).toBe(false);
            expect(store.row('a1@x.test')).toMatchObject({
                status: D.SKIPPED,
                attempts: 0,
                error: SubscriberStatus.BOUNCED,
            });
            expect(subscriptionService.markBounced).not.toHaveBeenCalled();
            expect(store.status('a2@x.test')).toBe(D.SENT);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        });

        it('still sends to a recipient on another of its lists, and to an ad-hoc one', async () => {
            store.newsletter = makeNewsletter({
                lists: [
                    { id: 'list-1', slug: 'updates', name: 'Updates' },
                    { id: 'list-2', slug: 'events', name: 'Events' },
                ] as Newsletter['lists'],
                adHocEmails: ['Guest@X.test'],
            });
            audience(
                2,
                [],
                [
                    {
                        subscriberId: 's-guest',
                        email: 'guest@x.test',
                        name: 'Guest',
                    },
                ],
            );
            store.subscribe('s-1', 'list-2');
            whileSending('a0@x.test', () => store.unsubscribe('s-1', 'list-1'));

            await service.handleSendNewsletter(task);

            expect(mailer.send).toHaveBeenCalledTimes(3);
            expect(store.status('a1@x.test')).toBe(D.SENT);
            expect(store.status('guest@x.test')).toBe(D.SENT);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        });

        it('leaves nothing in flight, so the next run claims at once', async () => {
            audience(30);
            whileSending('a0@x.test', () =>
                store.setSubscriberStatus('s-1', SubscriberStatus.UNSUBSCRIBED),
            );

            await service.handleSendNewsletter(task);

            expect(mailer.send).toHaveBeenCalledTimes(24);
            expect(store.row('a1@x.test')).toMatchObject({
                status: D.SKIPPED,
                claimedAt: null,
            });
            expect(store.rows.some((r) => r.status === D.SENDING)).toBe(false);
            expect(store.tasks).toHaveLength(1);

            await service.handleSendNewsletter(task);

            expect(mailer.send).toHaveBeenCalledTimes(29);
            expect(mailedTo('a1@x.test')).toBe(false);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
        });

        it('completes a batch whose every recipient left after the claim, sending nothing', async () => {
            audience(2);
            const claimBatch = store.claimBatch.bind(store);
            store.claimBatch = async (...args) => {
                const batch = await claimBatch(...args);
                store.setSubscriberStatus('s-0', SubscriberStatus.UNSUBSCRIBED);
                store.setSubscriberStatus('s-1', SubscriberStatus.UNSUBSCRIBED);
                return batch;
            };

            await service.handleSendNewsletter(task);

            expect(mailer.send).not.toHaveBeenCalled();
            expect(store.rows.every((r) => r.status === D.SKIPPED)).toBe(true);
            expect(store.newsletter.status).toBe(NewsletterStatus.SENT);
            expect(store.tasks).toEqual([]);
        });
    });

    it('pauses after a streak of failures instead of burning the list', async () => {
        audience(20);
        mailer.send.mockRejectedValue(
            smtpError('554 5.7.0 Message rejected', 'DATA'),
        );

        await service.handleSendNewsletter(task);

        expect(mailer.send).toHaveBeenCalledTimes(10);
        expect(store.newsletter.pausedUntil).toBeInstanceOf(Date);
        expect(store.newsletter.pauseReason).toMatch(
            /10 sends in a row failed/,
        );
        // Only the ten attempted spent an attempt.
        expect(
            store.rows.filter(
                (r) => r.attempts === 1 && r.status === D.PENDING,
            ),
        ).toHaveLength(10);
        expect(
            store.rows.filter(
                (r) => r.attempts === 0 && r.status === D.PENDING,
            ),
        ).toHaveLength(10);
    });

    it('counts newsletter emails sent in the last 24 hours', async () => {
        store.sentElsewhere = [
            new Date(Date.now() - DAY_MS - 1000),
            new Date(Date.now() - 1000),
        ];
        await expect(service.countSentLast24h()).resolves.toBe(1);
    });

    describe('recoverStalledSends', () => {
        it('releases stale claims and re-queues quiet newsletters', async () => {
            const before = Date.now();
            await service.recoverStalledSends();

            const [staleBefore] = store.releaseStaleClaims.mock
                .calls[0] as unknown as [Date];
            expect(staleBefore.getTime()).toBeGreaterThanOrEqual(
                before - NEWSLETTER_STALE_CLAIM_MS,
            );
            expect(staleBefore.getTime()).toBeLessThanOrEqual(
                Date.now() - NEWSLETTER_STALE_CLAIM_MS,
            );
            const [now, quietSince] = store.requeueStalled.mock
                .calls[0] as unknown as [Date, Date];
            expect(now.getTime() - quietSince.getTime()).toBe(
                NEWSLETTER_STALL_THRESHOLD_MS,
            );
        });

        it('never throws out of the cron', async () => {
            store.releaseStaleClaims.mockRejectedValueOnce(
                new Error('db down'),
            );
            await expect(
                service.recoverStalledSends(),
            ).resolves.toBeUndefined();
        });
    });
});
