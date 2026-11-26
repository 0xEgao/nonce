import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
    CohortType,
    PortalAudience,
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { Cohort } from '@/entities/cohort.entity';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import { MailingListsService } from '@/newsletter/lists/mailing-lists.service';
import {
    queryBuilderMock,
    SubscriptionStore,
} from '@/newsletter/subscribers/subscription-store.mock';

describe('MailingListsService', () => {
    let service: MailingListsService;
    let store: SubscriptionStore;
    let listRepository: ReturnType<SubscriptionStore['repository']>;
    let subscriptionRepository: ReturnType<SubscriptionStore['repository']>;
    let list: MailingList;

    const newsletterRepository = { count: jest.fn() };
    const userRepository = { createQueryBuilder: jest.fn() };
    const cohortRepository = { exists: jest.fn() };
    const dbTransactionService = { execute: jest.fn() };

    beforeEach(async () => {
        store = new SubscriptionStore();
        listRepository = store.repository(MailingList);
        subscriptionRepository = store.repository(MailingListSubscription);
        dbTransactionService.execute.mockImplementation(
            (fn: (m: EntityManager) => Promise<unknown>) =>
                fn(store.manager as unknown as EntityManager),
        );
        newsletterRepository.count.mockResolvedValue(0);
        list = store.addList({ name: 'Weekly', slug: 'weekly' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MailingListsService,
                {
                    provide: getRepositoryToken(MailingList),
                    useValue: listRepository,
                },
                {
                    provide: getRepositoryToken(MailingListSubscription),
                    useValue: subscriptionRepository,
                },
                {
                    provide: getRepositoryToken(Newsletter),
                    useValue: newsletterRepository,
                },
                {
                    provide: getRepositoryToken(User),
                    useValue: userRepository,
                },
                {
                    provide: getRepositoryToken(Cohort),
                    useValue: cohortRepository,
                },
                {
                    provide: DbTransactionService,
                    useValue: dbTransactionService,
                },
            ],
        }).compile();

        service = module.get(MailingListsService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('addSubscribers', () => {
        // One address in every state an import can meet.
        const seed = () => {
            const other = store.addList();
            const subscribed = store.addSubscriber('subscribed@example.com');
            store.addRow(list, subscribed, SubscriptionStatus.SUBSCRIBED);
            const left = store.addSubscriber('left@example.com');
            store.addRow(list, left, SubscriptionStatus.UNSUBSCRIBED, {
                unsubscribedAt: new Date('2026-02-01T00:00:00Z'),
            });
            // Re-entered on the public form after leaving; never confirmed.
            const reentered = store.addSubscriber('reentered@example.com');
            store.addRow(list, reentered, SubscriptionStatus.PENDING, {
                unsubscribedAt: new Date('2026-02-01T00:00:00Z'),
            });
            const pending = store.addSubscriber('pending@example.com');
            store.addRow(list, pending, SubscriptionStatus.PENDING);
            const bounced = store.addSubscriber('bounced@example.com', {
                status: SubscriberStatus.BOUNCED,
            });
            const optedOut = store.addSubscriber('optedout@example.com', {
                status: SubscriberStatus.UNSUBSCRIBED,
            });
            store.addRow(list, optedOut, SubscriptionStatus.UNSUBSCRIBED);
            const elsewhere = store.addSubscriber('elsewhere@example.com');
            store.addRow(other, elsewhere, SubscriptionStatus.SUBSCRIBED);
            return {
                subscribed,
                left,
                reentered,
                pending,
                bounced,
                optedOut,
                elsewhere,
            };
        };

        const everyone = [
            { email: 'subscribed@example.com' },
            { email: 'left@example.com' },
            { email: 'reentered@example.com' },
            { email: 'pending@example.com' },
            { email: 'bounced@example.com' },
            { email: 'optedout@example.com' },
            { email: 'elsewhere@example.com', name: 'Elsie' },
            { email: 'New@Example.com', name: 'Newt' },
            { email: ' new@example.com' },
            { email: 'not-an-email' },
            { email: '  ' },
        ];

        it('never re-subscribes someone who left, and the counts add up', async () => {
            const s = seed();

            const result = await service.addSubscribers(list.id, {
                subscribers: everyone,
            });

            expect(result).toEqual({
                added: 3, // pending, elsewhere, new
                alreadySubscribed: 1,
                skippedUnsubscribed: 2, // left, reentered
                skippedSuppressed: 2, // bounced, optedOut
                invalid: ['not-an-email'],
            });
            // 8 unique valid addresses, each counted once.
            expect(
                result.added +
                    result.alreadySubscribed +
                    result.skippedUnsubscribed +
                    result.skippedSuppressed,
            ).toBe(8);

            const newt = store.subscriberFor('new@example.com');
            expect(newt.name).toBe('Newt');
            expect(store.rowFor(list, newt)).toMatchObject({
                status: SubscriptionStatus.SUBSCRIBED,
                source: SubscriptionSource.ADMIN,
                confirmedAt: expect.any(Date),
            });
            expect(store.rowFor(list, s.elsewhere)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
            expect(s.elsewhere.name).toBe('Elsie');
            expect(store.rowFor(list, s.pending)?.status).toBe(
                SubscriptionStatus.SUBSCRIBED,
            );
            expect(store.rowFor(list, s.left)?.status).toBe(
                SubscriptionStatus.UNSUBSCRIBED,
            );
            expect(store.rowFor(list, s.reentered)?.status).toBe(
                SubscriptionStatus.PENDING,
            );
            expect(store.rowFor(list, s.bounced)).toBeUndefined();
            expect(s.bounced.status).toBe(SubscriberStatus.BOUNCED);
            expect(s.optedOut.status).toBe(SubscriberStatus.UNSUBSCRIBED);
            expect(dbTransactionService.execute).toHaveBeenCalledTimes(1);
        });

        it('with resubscribe, brings everyone back', async () => {
            const s = seed();

            const result = await service.addSubscribers(list.id, {
                subscribers: everyone,
                resubscribe: true,
            });

            expect(result).toEqual({
                added: 7,
                alreadySubscribed: 1,
                skippedUnsubscribed: 0,
                skippedSuppressed: 0,
                invalid: ['not-an-email'],
            });
            for (const subscriber of [
                s.left,
                s.reentered,
                s.bounced,
                s.optedOut,
            ]) {
                expect(store.rowFor(list, subscriber)).toMatchObject({
                    status: SubscriptionStatus.SUBSCRIBED,
                    unsubscribedAt: null,
                });
            }
            expect(s.bounced).toMatchObject({
                status: SubscriberStatus.ACTIVE,
                statusReason: null,
            });
            expect(s.optedOut.status).toBe(SubscriberStatus.ACTIVE);
        });

        it('counts a row that appeared mid-import as already subscribed', async () => {
            // The plan reads no row for this address; a concurrent request
            // adds one before the insert, which then skips it.
            const racer = store.addSubscriber('racer@example.com');
            store.manager.find.mockImplementationOnce(async () => [racer]);
            store.manager.find.mockImplementationOnce(async () => {
                store.addRow(list, racer, SubscriptionStatus.SUBSCRIBED);
                return [];
            });

            const result = await service.addSubscribers(list.id, {
                subscribers: [{ email: 'racer@example.com' }],
            });

            expect(result).toMatchObject({ added: 0, alreadySubscribed: 1 });
        });

        describe('a PENDING row that changes after the plan read it', () => {
            const leftAt = new Date('2026-02-01T00:00:00Z');
            const confirmedAt = new Date('2026-02-02T00:00:00Z');

            // The plan reads a copy of the row; `change` then lands on the
            // stored one before the promote runs.
            const raceRow = (change: Partial<MailingListSubscription>) => {
                const person = store.addSubscriber('person@example.com');
                const row = store.addRow(
                    list,
                    person,
                    SubscriptionStatus.PENDING,
                );
                store.manager.find.mockImplementationOnce(async () => [person]);
                store.manager.find.mockImplementationOnce(async () => {
                    const snapshot = { ...row };
                    Object.assign(row, change);
                    return [snapshot];
                });
                return row;
            };

            const add = (resubscribe?: boolean) =>
                service.addSubscribers(list.id, {
                    subscribers: [{ email: 'person@example.com' }],
                    resubscribe,
                });

            it('stays unsubscribed when they left in between', async () => {
                const row = raceRow({
                    status: SubscriptionStatus.UNSUBSCRIBED,
                    unsubscribedAt: leftAt,
                });

                const result = await add();

                expect(row).toMatchObject({
                    status: SubscriptionStatus.UNSUBSCRIBED,
                    unsubscribedAt: leftAt,
                });
                expect(result).toEqual({
                    added: 0,
                    alreadySubscribed: 0,
                    skippedUnsubscribed: 1,
                    skippedSuppressed: 0,
                    invalid: [],
                });
            });

            it('stays PENDING when they left and signed up again in between', async () => {
                const row = raceRow({ unsubscribedAt: leftAt });

                const result = await add();

                expect(row).toMatchObject({
                    status: SubscriptionStatus.PENDING,
                    unsubscribedAt: leftAt,
                });
                expect(result).toMatchObject({
                    added: 0,
                    skippedUnsubscribed: 1,
                });
            });

            it('counts a row confirmed in between as already subscribed', async () => {
                const row = raceRow({
                    status: SubscriptionStatus.SUBSCRIBED,
                    confirmedAt,
                });

                const result = await add();

                expect(row).toMatchObject({
                    status: SubscriptionStatus.SUBSCRIBED,
                    confirmedAt,
                });
                expect(result).toMatchObject({
                    added: 0,
                    alreadySubscribed: 1,
                    skippedUnsubscribed: 0,
                });
            });

            it('with resubscribe, still brings them back', async () => {
                const row = raceRow({
                    status: SubscriptionStatus.UNSUBSCRIBED,
                    unsubscribedAt: leftAt,
                });

                const result = await add(true);

                expect(row).toMatchObject({
                    status: SubscriptionStatus.SUBSCRIBED,
                    unsubscribedAt: null,
                });
                expect(result).toMatchObject({
                    added: 1,
                    skippedUnsubscribed: 0,
                });
            });
        });

        it('works through a large import in chunks', async () => {
            const subscribers = Array.from({ length: 2500 }, (_, i) => ({
                email: `person${i}@example.com`,
            }));

            const result = await service.addSubscribers(list.id, {
                subscribers,
            });

            expect(result.added).toBe(2500);
            expect(store.rows).toHaveLength(2500);
            const batchSizes = store.inserts.map(
                (insert) => insert.values.length,
            );
            expect(Math.max(...batchSizes)).toBeLessThanOrEqual(1000);
        });

        it('404s for an unknown list', async () => {
            await expect(
                service.addSubscribers('missing', {
                    subscribers: [{ email: 'a@example.com' }],
                }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('addPortalUsers', () => {
        const users = [
            { email: 'Alice@Example.com', displayName: 'Alice' },
            { email: 'bob@example.com', displayName: 'bob_discord' },
        ];

        const mockUserQuery = () => {
            const qb = queryBuilderMock({ getMany: users });
            userRepository.createQueryBuilder.mockReturnValue(qb);
            return qb;
        };

        it('dry run counts without writing anything', async () => {
            mockUserQuery();
            const bob = store.addSubscriber('bob@example.com');
            store.addRow(list, bob, SubscriptionStatus.SUBSCRIBED);

            const result = await service.addPortalUsers(list.id, {
                audience: PortalAudience.ALL_USERS,
                dryRun: true,
            });

            expect(result).toEqual({
                added: 1,
                alreadySubscribed: 1,
                skippedUnsubscribed: 0,
                skippedSuppressed: 0,
                invalid: [],
            });
            expect(store.inserts).toHaveLength(0);
            expect(store.findSubscriber('alice@example.com')).toBeUndefined();
            expect(dbTransactionService.execute).not.toHaveBeenCalled();
        });

        it('copies users in as PORTAL_USERS, named by display name', async () => {
            const qb = mockUserQuery();

            await service.addPortalUsers(list.id, {
                audience: PortalAudience.FELLOWS,
            });

            expect(qb.where).toHaveBeenCalledWith('user.email IS NOT NULL');
            expect(qb.innerJoin).toHaveBeenCalledWith(
                'user.fellowships',
                'fellowship',
            );
            const alice = store.subscriberFor('alice@example.com');
            expect(alice.name).toBe('Alice');
            expect(store.rowFor(list, alice)).toMatchObject({
                status: SubscriptionStatus.SUBSCRIBED,
                source: SubscriptionSource.PORTAL_USERS,
            });
        });

        it('filters the waitlist by cohort type when given', async () => {
            const qb = mockUserQuery();

            await service.addPortalUsers(list.id, {
                audience: PortalAudience.WAITLIST,
                cohortType: CohortType.MASTERING_BITCOIN,
                dryRun: true,
            });

            expect(qb.innerJoin).toHaveBeenCalledWith(
                'user.cohortsWaitlist',
                'waitlist',
                'waitlist.type = :cohortType',
                { cohortType: CohortType.MASTERING_BITCOIN },
            );
        });

        it('needs a real cohort for COHORT_MEMBERS', async () => {
            mockUserQuery();
            await expect(
                service.addPortalUsers(list.id, {
                    audience: PortalAudience.COHORT_MEMBERS,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);

            cohortRepository.exists.mockResolvedValue(false);
            await expect(
                service.addPortalUsers(list.id, {
                    audience: PortalAudience.COHORT_MEMBERS,
                    cohortId: '00000000-0000-4000-8000-000000000001',
                }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('lists', () => {
        it('counts every list in one grouped query', async () => {
            store.addList({ name: 'Events' });
            const qb = queryBuilderMock({
                getRawMany: [
                    {
                        listId: list.id,
                        subscriberCount: '12',
                        pendingCount: '3',
                        unsubscribedCount: '4',
                    },
                ],
            });
            subscriptionRepository.createQueryBuilder.mockReturnValue(qb);

            const result = await service.list({});

            expect(
                subscriptionRepository.createQueryBuilder,
            ).toHaveBeenCalledTimes(1);
            expect(qb.addSelect).toHaveBeenCalledWith(
                expect.stringContaining('subscriber.status = :active'),
                'subscriberCount',
            );
            expect(
                result.map((l) => [
                    l.name,
                    l.subscriberCount,
                    l.pendingCount,
                    l.unsubscribedCount,
                ]),
            ).toEqual([
                ['Weekly', 12, 3, 4],
                ['Events', 0, 0, 0],
            ]);
        });

        it('hides archived lists unless asked', async () => {
            store.addList({ name: 'Old', archivedAt: new Date() });

            expect((await service.list({})).map((l) => l.name)).toEqual([
                'Weekly',
            ]);
            expect(
                (await service.list({ includeArchived: true })).map(
                    (l) => l.name,
                ),
            ).toEqual(['Weekly', 'Old']);
        });

        it('derives the slug from the name', async () => {
            const created = await service.create({ name: 'Café Club' });
            expect(created.slug).toBe('cafe-club');
        });

        it('falls back to a random slug when the name has no ASCII', async () => {
            const created = await service.create({ name: 'बिटकॉइन' });
            expect(created.slug).toMatch(/^list-[0-9a-f]{6}$/);
        });

        it('409s on a slug clash', async () => {
            await expect(
                service.create({ name: 'Weekly' }),
            ).rejects.toBeInstanceOf(ConflictException);
        });

        it('archives and restores', async () => {
            await service.update(list.id, { archived: true });
            expect(list.archivedAt).toBeInstanceOf(Date);

            await service.update(list.id, { archived: false });
            expect(list.archivedAt).toBeNull();
        });

        it('refuses to delete a list a newsletter uses', async () => {
            newsletterRepository.count.mockResolvedValue(2);

            await expect(service.remove(list.id)).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(store.lists).toContain(list);
        });

        it('deletes an unused list', async () => {
            await service.remove(list.id);
            expect(store.lists).not.toContain(list);
        });
    });

    describe('subscriptions', () => {
        it('only removes a row that belongs to the list', async () => {
            const other = store.addList();
            const alice = store.addSubscriber('alice@example.com');
            const row = store.addRow(
                other,
                alice,
                SubscriptionStatus.SUBSCRIBED,
            );

            await expect(
                service.removeSubscription(list.id, row.id),
            ).rejects.toBeInstanceOf(NotFoundException);

            await service.removeSubscription(other.id, row.id);
            expect(store.rows).toHaveLength(0);
        });

        it('escapes the search term for ILIKE', async () => {
            const qb = queryBuilderMock();
            subscriptionRepository.createQueryBuilder.mockReturnValue(qb);

            await service.listSubscribers(list.id, {
                page: 0,
                pageSize: 10,
                search: '50%_off',
            });

            expect(qb.andWhere).toHaveBeenCalledWith(expect.anything(), {
                search: '%50\\%\\_off%',
            });
        });

        it('exports CSV with quoting and formula injection defused', async () => {
            const alice = store.addSubscriber('alice@example.com', {
                name: '=HYPERLINK("http://evil.example")',
            });
            const bob = store.addSubscriber('bob@example.com', {
                name: 'Smith, Bob',
            });
            store.addRow(list, alice, SubscriptionStatus.SUBSCRIBED, {
                confirmedAt: new Date('2026-05-01T10:00:00.000Z'),
            });
            store.addRow(list, bob, SubscriptionStatus.PENDING, {
                source: SubscriptionSource.PUBLIC_FORM,
            });

            const csv = await service.exportSubscribers(list.id);

            expect(csv.fileName).toMatch(
                /^weekly-subscribers-\d{4}-\d{2}-\d{2}\.csv$/,
            );
            expect(csv.content).toBe(
                'email,name,status,source,subscribedAt\r\n' +
                    'alice@example.com,"\'=HYPERLINK(""http://evil.example"")",SUBSCRIBED,ADMIN,2026-05-01T10:00:00.000Z\r\n' +
                    'bob@example.com,"Smith, Bob",PENDING,PUBLIC_FORM,\r\n',
            );
        });
    });
});
