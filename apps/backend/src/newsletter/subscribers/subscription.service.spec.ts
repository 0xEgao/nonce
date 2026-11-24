import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import {
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import { DiscordAlertService } from '@/common/discord-alert.service';
import { MailService } from '@/mail/mail.service';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import {
    NEWSLETTER_CONFIRMATION_DAILY_CAP,
    NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS,
} from '@/newsletter/newsletter.constants';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';
import {
    queryBuilderMock,
    SubscriptionStore,
} from '@/newsletter/subscribers/subscription-store.mock';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const HOUR_MS = 60 * 60 * 1000;

describe('SubscriptionService', () => {
    let service: SubscriptionService;
    let store: SubscriptionStore;
    let subscriberRepository: ReturnType<SubscriptionStore['repository']>;
    let listRepository: ReturnType<SubscriptionStore['repository']>;
    let logError: jest.SpyInstance;

    const mailService = {
        sendNewsletterSubscriptionConfirmationEmail: jest.fn(),
        sendNewsletterPreferencesLinkEmail: jest.fn(),
    };
    const urlService = {
        confirmUrl: jest.fn(
            (token: string) =>
                `https://app.test/newsletter/confirm?token=${token}`,
        ),
        preferencesUrl: jest.fn(
            (token: string) =>
                `https://app.test/newsletter/preferences?token=${token}`,
        ),
    };
    const dbTransactionService = { execute: jest.fn() };
    const discordAlert = { sendErrorAlert: jest.fn() };

    /** Addresses sent a confirmation an hour ago: enough to spend the cap. */
    const spendDailyCap = (count = NEWSLETTER_CONFIRMATION_DAILY_CAP) => {
        const anHourAgo = new Date(Date.now() - HOUR_MS);
        for (let i = 0; i < count; i++) {
            store.addSubscriber(`earlier-${i}@example.com`, {
                lastConfirmationSentAt: anHourAgo,
            });
        }
    };

    beforeEach(async () => {
        store = new SubscriptionStore();
        subscriberRepository = store.repository(Subscriber);
        listRepository = store.repository(MailingList);
        dbTransactionService.execute.mockImplementation(
            (fn: (m: EntityManager) => Promise<unknown>) =>
                fn(store.manager as unknown as EntityManager),
        );
        mailService.sendNewsletterSubscriptionConfirmationEmail.mockResolvedValue(
            undefined,
        );
        mailService.sendNewsletterPreferencesLinkEmail.mockResolvedValue(
            undefined,
        );
        discordAlert.sendErrorAlert.mockResolvedValue(undefined);
        logError = jest
            .spyOn(Logger.prototype, 'error')
            .mockImplementation(() => undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SubscriptionService,
                {
                    provide: getRepositoryToken(Subscriber),
                    useValue: subscriberRepository,
                },
                {
                    provide: getRepositoryToken(MailingList),
                    useValue: listRepository,
                },
                {
                    provide: getRepositoryToken(MailingListSubscription),
                    useValue: store.repository(MailingListSubscription),
                },
                {
                    provide: getRepositoryToken(Newsletter),
                    useValue: store.repository(Newsletter),
                },
                {
                    provide: DbTransactionService,
                    useValue: dbTransactionService,
                },
                { provide: MailService, useValue: mailService },
                { provide: NewsletterUrlService, useValue: urlService },
                { provide: DiscordAlertService, useValue: discordAlert },
            ],
        }).compile();

        service = module.get(SubscriptionService);
    });

    afterEach(() => {
        logError.mockRestore();
        jest.clearAllMocks();
    });

    describe('subscribe', () => {
        it('does nothing at all when the honeypot is filled', async () => {
            store.addList({ slug: 'weekly' });

            await service.subscribe({
                email: 'bot@example.com',
                listSlugs: ['weekly'],
                website: 'http://spam.example',
            });

            expect(listRepository.find).not.toHaveBeenCalled();
            expect(dbTransactionService.execute).not.toHaveBeenCalled();
            expect(store.subscribers).toHaveLength(0);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).not.toHaveBeenCalled();
        });

        it('only ever looks up public, non-archived lists', async () => {
            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['Weekly ', 'private'],
            });

            expect(listRepository.find).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    isPublic: true,
                    archivedAt: IsNull(),
                }),
            });
        });

        it('creates nothing and sends nothing when no requested list is open', async () => {
            store.addList({ slug: 'private', isPublic: false });
            store.addList({ slug: 'old', archivedAt: new Date() });

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['private', 'old', 'unknown'],
            });

            expect(store.subscribers).toHaveLength(0);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).not.toHaveBeenCalled();
        });

        it('makes a new address PENDING on the open lists only and sends one confirmation', async () => {
            const weekly = store.addList({ slug: 'weekly', name: 'Weekly' });
            const events = store.addList({ slug: 'events', name: 'Events' });
            const internal = store.addList({
                slug: 'internal',
                isPublic: false,
            });

            await service.subscribe({
                email: '  Alice@Example.COM ',
                name: 'Alice',
                listSlugs: ['weekly', 'events', 'internal'],
            });

            const alice = store.subscriberFor('alice@example.com');
            expect(alice).toMatchObject({
                name: 'Alice',
                status: SubscriberStatus.ACTIVE,
            });
            expect(store.rowFor(weekly, alice)).toMatchObject({
                status: SubscriptionStatus.PENDING,
                source: SubscriptionSource.PUBLIC_FORM,
            });
            expect(store.rowFor(events, alice)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(store.rowFor(internal, alice)).toBeUndefined();
            expect(alice.lastConfirmationSentAt).toBeInstanceOf(Date);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledTimes(1);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledWith(
                'alice@example.com',
                ['Events', 'Weekly'],
                `https://app.test/newsletter/confirm?token=${alice.token}`,
            );
        });

        it('sends nothing for an address already subscribed to everything it asked for', async () => {
            const weekly = store.addList({ slug: 'weekly' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
            expect(alice.lastConfirmationSentAt).toBeNull();
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).not.toHaveBeenCalled();
        });

        it('records the sign-up but sends nothing inside the resend window', async () => {
            const weekly = store.addList({ slug: 'weekly' });
            const lastSent = new Date(
                Date.now() - NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS / 2,
            );
            const alice = store.addSubscriber('alice@example.com', {
                lastConfirmationSentAt: lastSent,
            });

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(alice.lastConfirmationSentAt).toBe(lastSent);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).not.toHaveBeenCalled();
        });

        it('sends again once the resend window has passed, naming every pending list', async () => {
            const weekly = store.addList({ slug: 'weekly', name: 'Weekly' });
            const events = store.addList({ slug: 'events', name: 'Events' });
            const alice = store.addSubscriber('alice@example.com', {
                lastConfirmationSentAt: new Date(
                    Date.now() -
                        NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS -
                        1000,
                ),
            });
            store.addRow(events, alice, SubscriptionStatus.PENDING, {
                source: SubscriptionSource.PUBLIC_FORM,
            });

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledWith(
                'alice@example.com',
                ['Events', 'Weekly'],
                expect.any(String),
            );
        });

        it('puts an unsubscribed row back to PENDING but keeps when they left', async () => {
            const weekly = store.addList({ slug: 'weekly' });
            const alice = store.addSubscriber('alice@example.com');
            const leftAt = new Date('2026-03-01T00:00:00Z');
            store.addRow(weekly, alice, SubscriptionStatus.UNSUBSCRIBED, {
                unsubscribedAt: leftAt,
            });

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            expect(store.rowFor(weekly, alice)).toMatchObject({
                status: SubscriptionStatus.PENDING,
                unsubscribedAt: leftAt,
            });
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledTimes(1);
        });

        it('asks a bounced address to reconfirm even lists it is still on', async () => {
            const weekly = store.addList({ slug: 'weekly' });
            const alice = store.addSubscriber('alice@example.com', {
                status: SubscriberStatus.BOUNCED,
            });
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);

            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledTimes(1);
        });

        it('never overwrites a stored name from the public form', async () => {
            store.addList({ slug: 'weekly' });
            const alice = store.addSubscriber('alice@example.com', {
                name: 'Alice',
            });

            await service.subscribe({
                email: 'alice@example.com',
                name: 'Mallory',
                listSlugs: ['weekly'],
            });

            expect(alice.name).toBe('Alice');
        });

        it('never fills in a missing name on an existing subscriber', async () => {
            const weekly = store.addList({ slug: 'weekly' });
            const events = store.addList({ slug: 'events' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);

            // Once with something to confirm, once with nothing.
            await service.subscribe({
                email: 'alice@example.com',
                name: 'Mallory',
                listSlugs: ['weekly'],
            });
            await service.subscribe({
                email: 'alice@example.com',
                name: 'Mallory',
                listSlugs: ['events'],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(alice.name).toBeNull();
            expect(store.manager.update).not.toHaveBeenCalledWith(
                Subscriber,
                expect.anything(),
                expect.objectContaining({ name: expect.anything() }),
            );
        });

        it('swallows a mail failure and frees the resend window', async () => {
            store.addList({ slug: 'weekly' });
            mailService.sendNewsletterSubscriptionConfirmationEmail.mockRejectedValue(
                new Error('SMTP down'),
            );

            await expect(
                service.subscribe({
                    email: 'alice@example.com',
                    listSlugs: ['weekly'],
                }),
            ).resolves.toBeUndefined();
            await flushPromises();

            expect(
                store.subscriberFor('alice@example.com')
                    ?.lastConfirmationSentAt,
            ).toBeNull();
            expect(logError).toHaveBeenCalled();
        });

        describe('daily cap', () => {
            it('records the sign-up but sends nothing once the cap is spent', async () => {
                const weekly = store.addList({ slug: 'weekly' });
                spendDailyCap();

                await expect(
                    service.subscribe({
                        email: 'alice@example.com',
                        name: 'Alice',
                        listSlugs: ['weekly'],
                    }),
                ).resolves.toBeUndefined();

                const alice = store.subscriberFor('alice@example.com');
                expect(store.rowFor(weekly, alice)?.status).toBe(
                    SubscriptionStatus.PENDING,
                );
                expect(alice.lastConfirmationSentAt).toBeNull();
                expect(
                    mailService.sendNewsletterSubscriptionConfirmationEmail,
                ).not.toHaveBeenCalled();
                expect(logError).toHaveBeenCalledTimes(1);
                expect(logError.mock.calls[0][0]).toContain('daily cap');
                expect(discordAlert.sendErrorAlert).toHaveBeenCalledTimes(1);
            });

            it('only counts addresses sent one in the last 24 hours', async () => {
                store.addList({ slug: 'weekly' });
                spendDailyCap(NEWSLETTER_CONFIRMATION_DAILY_CAP - 1);
                store.addSubscriber('yesterday@example.com', {
                    lastConfirmationSentAt: new Date(Date.now() - 25 * HOUR_MS),
                });

                await service.subscribe({
                    email: 'alice@example.com',
                    listSlugs: ['weekly'],
                });

                expect(
                    mailService.sendNewsletterSubscriptionConfirmationEmail,
                ).toHaveBeenCalledTimes(1);
                expect(logError).not.toHaveBeenCalled();
                expect(discordAlert.sendErrorAlert).not.toHaveBeenCalled();
            });

            it('logs every capped request but alerts Discord at most hourly', async () => {
                store.addList({ slug: 'weekly' });
                spendDailyCap();

                for (const email of ['a@example.com', 'b@example.com']) {
                    await service.subscribe({ email, listSlugs: ['weekly'] });
                }

                expect(logError).toHaveBeenCalledTimes(2);
                expect(discordAlert.sendErrorAlert).toHaveBeenCalledTimes(1);
            });

            it('does not count anything when there is nothing to send', async () => {
                const weekly = store.addList({ slug: 'weekly' });
                const alice = store.addSubscriber('alice@example.com');
                store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);

                await service.subscribe({
                    email: 'alice@example.com',
                    listSlugs: ['weekly'],
                });

                expect(store.manager.count).not.toHaveBeenCalled();
            });
        });
    });

    describe('confirm', () => {
        it('subscribes every PENDING row and reactivates the address', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const events = store.addList({ name: 'Events' });
            const alice = store.addSubscriber('alice@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
            });
            store.addRow(weekly, alice, SubscriptionStatus.PENDING, {
                unsubscribedAt: new Date('2026-03-01T00:00:00Z'),
            });
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);

            const result = await service.confirm(alice.token);

            expect(store.rowFor(weekly, alice)).toMatchObject({
                status: SubscriptionStatus.SUBSCRIBED,
                confirmedAt: expect.any(Date),
                unsubscribedAt: null,
            });
            expect(alice).toMatchObject({
                status: SubscriberStatus.ACTIVE,
                statusReason: null,
            });
            expect(result).toEqual({
                email: 'alice@example.com',
                lists: ['Events', 'Weekly'],
            });
        });

        it('is idempotent and never undoes a later global unsubscribe', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const alice = store.addSubscriber('alice@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
            });
            store.addRow(weekly, alice, SubscriptionStatus.UNSUBSCRIBED);

            const result = await service.confirm(alice.token);

            expect(alice.status).toBe(SubscriberStatus.UNSUBSCRIBED);
            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(result.lists).toEqual([]);
        });

        it('404s on an unknown token', async () => {
            await expect(service.confirm('nope')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('preferences', () => {
        it('shows public lists plus any list the address has a row on', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const internal = store.addList({
                name: 'Internal',
                isPublic: false,
            });
            store.addList({ name: 'Hidden', isPublic: false });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(internal, alice, SubscriptionStatus.SUBSCRIBED);

            const result = await service.getPreferencesByToken(alice.token);

            expect(result.status).toBe(SubscriberStatus.ACTIVE);
            expect(
                result.lists.map((list) => [list.name, list.status]),
            ).toEqual([
                ['Internal', SubscriptionStatus.SUBSCRIBED],
                ['Weekly', null],
            ]);
            expect(result.lists[0].id).toBe(internal.id);
            expect(result.lists[1].id).toBe(weekly.id);
        });

        it('makes the given set the whole set, immediately', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const events = store.addList({ name: 'Events' });
            const internal = store.addList({ isPublic: false });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(internal, alice, SubscriptionStatus.PENDING);

            await service.updatePreferencesByToken(alice.token, {
                subscribedListIds: [weekly.id, internal.id],
            });

            expect(store.rowFor(weekly, alice)).toMatchObject({
                status: SubscriptionStatus.SUBSCRIBED,
                source: SubscriptionSource.PUBLIC_FORM,
            });
            expect(store.rowFor(internal, alice)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
            expect(store.rowFor(events, alice)).toMatchObject({
                status: SubscriptionStatus.UNSUBSCRIBED,
                unsubscribedAt: expect.any(Date),
            });
            expect(alice.status).toBe(SubscriberStatus.ACTIVE);
        });

        it('rejects a private list the address is not on', async () => {
            const internal = store.addList({ isPublic: false });
            const alice = store.addSubscriber('alice@example.com');

            await expect(
                service.updatePreferencesByToken(alice.token, {
                    subscribedListIds: [internal.id],
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(store.rows).toHaveLength(0);
        });

        it('unsubscribeAll leaves every list and suppresses the address', async () => {
            const weekly = store.addList();
            const internal = store.addList({ isPublic: false });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(internal, alice, SubscriptionStatus.PENDING);

            const result = await service.updatePreferencesByToken(alice.token, {
                subscribedListIds: [weekly.id],
                unsubscribeAll: true,
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(store.rowFor(internal, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(alice.status).toBe(SubscriberStatus.UNSUBSCRIBED);
            expect(result.status).toBe(SubscriberStatus.UNSUBSCRIBED);
        });

        it('subscribing to anything reactivates a suppressed address', async () => {
            const weekly = store.addList();
            const alice = store.addSubscriber('alice@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
                statusReason: 'Unsubscribed from all lists',
            });

            await service.updatePreferencesByToken(alice.token, {
                subscribedListIds: [weekly.id],
            });

            expect(alice).toMatchObject({
                status: SubscriberStatus.ACTIVE,
                statusReason: null,
            });
        });

        it('an empty set unsubscribes from lists but leaves the address active', async () => {
            const weekly = store.addList();
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);

            await service.updatePreferencesByToken(alice.token, {
                subscribedListIds: [],
            });

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(alice.status).toBe(SubscriberStatus.ACTIVE);
        });
    });

    describe('sendPreferencesLink', () => {
        const user = (email: string | null) =>
            ({ email, displayName: 'Alice A' }) as unknown as User;

        it('400s for a user without an email, touching nothing', async () => {
            await expect(
                service.sendPreferencesLink(user(null)),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                service.sendPreferencesLink(user('   ')),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(dbTransactionService.execute).not.toHaveBeenCalled();
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).not.toHaveBeenCalled();
        });

        it('creates an active subscriber on no list and mails it the link', async () => {
            store.addList({ name: 'Weekly' });

            await service.sendPreferencesLink(user(' Alice@Example.com '));

            const alice = store.subscriberFor('alice@example.com');
            expect(alice).toMatchObject({
                name: null,
                status: SubscriberStatus.ACTIVE,
                lastConfirmationSentAt: expect.any(Date),
            });
            expect(store.rows).toHaveLength(0);
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).toHaveBeenCalledWith(
                'alice@example.com',
                `https://app.test/newsletter/preferences?token=${alice.token}`,
            );
        });

        it('leaves an existing subscriber and its lists as they are', async () => {
            const weekly = store.addList();
            const leftAt = new Date('2026-03-01T00:00:00Z');
            const alice = store.addSubscriber('alice@example.com', {
                name: 'Alice',
                status: SubscriberStatus.UNSUBSCRIBED,
                statusReason: 'Unsubscribed from all lists',
            });
            store.addRow(weekly, alice, SubscriptionStatus.UNSUBSCRIBED, {
                unsubscribedAt: leftAt,
            });

            await service.sendPreferencesLink(user('alice@example.com'));

            expect(store.subscribers).toHaveLength(1);
            expect(alice).toMatchObject({
                name: 'Alice',
                status: SubscriberStatus.UNSUBSCRIBED,
                statusReason: 'Unsubscribed from all lists',
                token: 'token-alice@example.com',
            });
            expect(store.rowFor(weekly, alice)).toMatchObject({
                status: SubscriptionStatus.UNSUBSCRIBED,
                unsubscribedAt: leftAt,
            });
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).toHaveBeenCalledWith(
                'alice@example.com',
                'https://app.test/newsletter/preferences?token=token-alice@example.com',
            );
        });

        it('sends nothing inside the resend window', async () => {
            const lastSent = new Date(
                Date.now() - NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS / 2,
            );
            const alice = store.addSubscriber('alice@example.com', {
                lastConfirmationSentAt: lastSent,
            });

            await expect(
                service.sendPreferencesLink(user('alice@example.com')),
            ).resolves.toBeUndefined();

            expect(alice.lastConfirmationSentAt).toBe(lastSent);
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).not.toHaveBeenCalled();
        });

        it('shares the resend window with a public sign-up', async () => {
            store.addList({ slug: 'weekly' });
            await service.subscribe({
                email: 'alice@example.com',
                listSlugs: ['weekly'],
            });

            await service.sendPreferencesLink(user('alice@example.com'));

            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).toHaveBeenCalledTimes(1);
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).not.toHaveBeenCalled();
        });

        it('sends nothing once the daily cap is spent', async () => {
            spendDailyCap();

            await expect(
                service.sendPreferencesLink(user('alice@example.com')),
            ).resolves.toBeUndefined();

            expect(
                store.subscriberFor('alice@example.com').lastConfirmationSentAt,
            ).toBeNull();
            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).not.toHaveBeenCalled();
            expect(logError).toHaveBeenCalledTimes(1);
            expect(discordAlert.sendErrorAlert).toHaveBeenCalledTimes(1);
        });

        it('counts against the cap the public form checks', async () => {
            store.addList({ slug: 'weekly' });
            spendDailyCap(NEWSLETTER_CONFIRMATION_DAILY_CAP - 1);

            await service.sendPreferencesLink(user('alice@example.com'));
            await service.subscribe({
                email: 'bob@example.com',
                listSlugs: ['weekly'],
            });

            expect(
                mailService.sendNewsletterPreferencesLinkEmail,
            ).toHaveBeenCalledTimes(1);
            expect(
                mailService.sendNewsletterSubscriptionConfirmationEmail,
            ).not.toHaveBeenCalled();
        });

        it('frees the resend window when the email fails', async () => {
            mailService.sendNewsletterPreferencesLinkEmail.mockRejectedValue(
                new Error('SMTP down'),
            );

            await service.sendPreferencesLink(user('alice@example.com'));
            await flushPromises();

            expect(
                store.subscriberFor('alice@example.com').lastConfirmationSentAt,
            ).toBeNull();
            expect(logError).toHaveBeenCalled();
        });
    });

    describe('unsubscribe', () => {
        it("with a newsletter, leaves only that newsletter's lists", async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const events = store.addList({ name: 'Events' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);
            const newsletter = store.addNewsletter([weekly]);

            const result = await service.unsubscribe({
                token: alice.token,
                newsletterId: newsletter.id,
            });

            expect(result).toEqual({
                email: 'alice@example.com',
                unsubscribedLists: ['Weekly'],
                global: false,
            });
            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(store.rowFor(events, alice)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
            expect(alice.status).toBe(SubscriberStatus.ACTIVE);
        });

        it('a repeat click does not escalate to a global unsubscribe', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.UNSUBSCRIBED);
            const newsletter = store.addNewsletter([weekly]);

            const result = await service.unsubscribe({
                token: alice.token,
                newsletterId: newsletter.id,
            });

            expect(result.global).toBe(false);
            expect(alice.status).toBe(SubscriberStatus.ACTIVE);
        });

        it('an ad-hoc recipient is unsubscribed globally', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const events = store.addList({ name: 'Events' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);
            // Alice got this one as an ad-hoc recipient, not through Weekly.
            const newsletter = store.addNewsletter([weekly]);

            const result = await service.unsubscribe({
                token: alice.token,
                newsletterId: newsletter.id,
            });

            expect(result).toEqual({
                email: 'alice@example.com',
                unsubscribedLists: ['Events'],
                global: true,
            });
            expect(alice.status).toBe(SubscriberStatus.UNSUBSCRIBED);
            expect(store.rowFor(events, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
        });

        const everythingCases: [
            string,
            (newsletterId: string) => { newsletterId?: string; all?: boolean },
        ][] = [
            ['no newsletter', () => ({})],
            ['all: true', (newsletterId) => ({ newsletterId, all: true })],
        ];
        it.each(everythingCases)('%s means everything', async (_, extra) => {
            const weekly = store.addList({ name: 'Weekly' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);
            const newsletter = store.addNewsletter([weekly]);

            const result = await service.unsubscribe({
                token: alice.token,
                ...extra(newsletter.id),
            });

            expect(result.global).toBe(true);
            expect(alice.status).toBe(SubscriberStatus.UNSUBSCRIBED);
            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
        });

        it('404s on an unknown token', async () => {
            await expect(
                service.unsubscribe({ token: 'nope' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('one-click never throws, even for an unknown token', async () => {
            await expect(
                service.unsubscribeOneClick('nope', 'not-a-uuid'),
            ).resolves.toBeUndefined();
            await expect(
                service.unsubscribeOneClick(''),
            ).resolves.toBeUndefined();
        });

        it('one-click behaves like unsubscribe with that newsletter', async () => {
            const weekly = store.addList({ name: 'Weekly' });
            const events = store.addList({ name: 'Events' });
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);
            const newsletter = store.addNewsletter([weekly]);

            await service.unsubscribeOneClick(alice.token, newsletter.id);

            expect(store.rowFor(weekly, alice)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(store.rowFor(events, alice)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
        });
    });

    describe('resolveAudience', () => {
        // Stands in for the one read: subscribers with a SUBSCRIBED row on
        // the lists, or one of the ad-hoc addresses, each once.
        beforeEach(() => {
            subscriberRepository.createQueryBuilder.mockImplementation(() => {
                const qb = queryBuilderMock();
                qb.getMany.mockImplementation(async () => {
                    const [, params] = qb.where.mock.calls[0];
                    return store.subscribers.filter(
                        (subscriber) =>
                            store.rows.some(
                                (row) =>
                                    row.subscriber.id === subscriber.id &&
                                    params.listIds.includes(row.list.id) &&
                                    row.status ===
                                        SubscriptionStatus.SUBSCRIBED,
                            ) || params.adHocEmails.includes(subscriber.email),
                    );
                });
                return qb;
            });
        });

        it('dedupes across lists and ad-hoc addresses, and skips suppressed ones', async () => {
            const weekly = store.addList();
            const events = store.addList();
            const alice = store.addSubscriber('alice@example.com', {
                name: 'Alice',
            });
            const bob = store.addSubscriber('bob@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
            });
            const carol = store.addSubscriber('carol@example.com', {
                status: SubscriberStatus.BOUNCED,
            });
            const dave = store.addSubscriber('dave@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(events, alice, SubscriptionStatus.SUBSCRIBED);
            store.addRow(weekly, bob, SubscriptionStatus.SUBSCRIBED);
            store.addRow(weekly, dave, SubscriptionStatus.PENDING);
            store.addRow(events, dave, SubscriptionStatus.UNSUBSCRIBED);

            const result = await service.resolveAudience(
                [weekly.id, events.id, weekly.id],
                [
                    'ALICE@example.com',
                    'carol@example.com',
                    'new@example.com',
                    'new@example.com ',
                    'not an email',
                    '',
                ],
            );

            const newbie = store.subscriberFor('new@example.com');
            expect(result.recipients).toEqual([
                {
                    subscriberId: alice.id,
                    email: 'alice@example.com',
                    name: 'Alice',
                },
                {
                    subscriberId: newbie.id,
                    email: 'new@example.com',
                    name: null,
                },
            ]);
            expect(result.skipped).toEqual([
                { email: 'bob@example.com', reason: 'Unsubscribed' },
                { email: 'carol@example.com', reason: 'Bounced' },
            ]);
            expect(result.invalid).toEqual(['not an email']);
            expect(
                subscriberRepository.createQueryBuilder,
            ).toHaveBeenCalledTimes(1);
            expect(carol.status).toBe(SubscriberStatus.BOUNCED);
        });

        it('writes nothing on a dry run; new ad-hoc addresses have no id yet', async () => {
            const weekly = store.addList();
            const alice = store.addSubscriber('alice@example.com');
            store.addRow(weekly, alice, SubscriptionStatus.SUBSCRIBED);

            const result = await service.resolveAudience(
                [weekly.id],
                ['new@example.com'],
                { dryRun: true },
            );

            expect(result.recipients).toEqual([
                {
                    subscriberId: alice.id,
                    email: 'alice@example.com',
                    name: null,
                },
                { subscriberId: null, email: 'new@example.com', name: null },
            ]);
            expect(store.inserts).toHaveLength(0);
            expect(store.subscribers).toHaveLength(1);
        });

        it('makes no query for an empty audience', async () => {
            const result = await service.resolveAudience([], ['bad']);

            expect(result).toEqual({
                recipients: [],
                skipped: [],
                invalid: ['bad'],
            });
            expect(
                subscriberRepository.createQueryBuilder,
            ).not.toHaveBeenCalled();
        });
    });

    describe('markBounced', () => {
        it('suppresses an active address with the reason', async () => {
            const alice = store.addSubscriber('alice@example.com');

            await service.markBounced(alice.id, '550 5.1.1 user unknown');

            expect(alice).toMatchObject({
                status: SubscriberStatus.BOUNCED,
                statusReason: '550 5.1.1 user unknown',
                statusChangedAt: expect.any(Date),
            });
        });

        it('keeps an address that already unsubscribed as UNSUBSCRIBED', async () => {
            const alice = store.addSubscriber('alice@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
            });

            await service.markBounced(alice.id, '550 5.1.1 user unknown');

            expect(alice.status).toBe(SubscriberStatus.UNSUBSCRIBED);
        });
    });
});
