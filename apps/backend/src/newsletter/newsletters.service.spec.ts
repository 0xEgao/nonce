import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, Repository } from 'typeorm';
import { MailingList } from '@/entities/mailing-list.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import {
    NewsletterContentFormat,
    NewsletterDeliveryStatus,
    NewsletterStatus,
} from '@/common/enum';
import { NewslettersService } from '@/newsletter/newsletters.service';
import { NewsletterRenderService } from '@/newsletter/newsletter-render.service';
import { NewsletterSendService } from '@/newsletter/newsletter-send.service';
import { DELIVERY_STILL_WANTED_SQL } from '@/newsletter/newsletter-send.store';
import { NewsletterMailerService } from '@/newsletter/newsletter-mailer.service';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import { SubscriptionService } from '@/newsletter/subscription.service';

// See newsletter-render.service.spec.ts: juice is ESM-only.
jest.mock('juice', () =>
    process.getBuiltinModule('module').createRequire(__filename)('juice'),
);

/** A query builder stand-in: every call chains, `terminals` resolve. */
function chain(terminals: Record<string, unknown>) {
    const calls: [string, unknown[]][] = [];
    const proxy: any = new Proxy(
        {},
        {
            get: (_target, prop: string) => {
                if (prop === 'calls') return calls;
                if (prop === 'then') return undefined;
                return (...args: unknown[]) => {
                    calls.push([prop, args]);
                    return prop in terminals
                        ? Promise.resolve(terminals[prop])
                        : proxy;
                };
            },
        },
    );
    return proxy;
}

const list = (id: string, overrides: Partial<MailingList> = {}) =>
    ({
        id,
        name: `List ${id}`,
        slug: id,
        archivedAt: null,
        ...overrides,
    }) as MailingList;

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
    return {
        id: 'nl-1',
        subject: 'Hello',
        preheader: null,
        contentFormat: NewsletterContentFormat.RICH_TEXT,
        content: '<p>Hi there</p>',
        replyTo: null,
        status: NewsletterStatus.DRAFT,
        lists: [list('l-1')],
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
        createdBy: { displayName: 'Ada' } as User,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-02T00:00:00Z'),
        ...overrides,
    } as Newsletter;
}

const user = { id: 'u-1', displayName: 'Ada' } as User;

describe('NewslettersService', () => {
    let service: NewslettersService;
    let stored: Newsletter;

    const newsletterRepository = {
        findOne: jest.fn(),
        create: jest.fn((entity: Partial<Newsletter>) => ({ ...entity })),
        save: jest.fn(async (entity: Partial<Newsletter>) => ({
            ...entity,
            id: 'nl-new',
        })),
        delete: jest.fn(),
        update: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
    const deliveryRepository = {
        query: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
    const mailingListRepository = { find: jest.fn() };
    const manager = {
        findOne: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        exists: jest.fn(),
        query: jest.fn(),
        createQueryBuilder: jest.fn(),
    };
    const dbTransactionService = {
        execute: jest.fn((fn: (m: EntityManager) => Promise<unknown>) =>
            fn(manager as unknown as EntityManager),
        ),
    };
    const subscriptionService = { resolveAudience: jest.fn() };
    const renderService = { render: jest.fn() };
    const sendService = {
        enqueue: jest.fn(),
        countSentLast24h: jest.fn(),
    };
    const mailer = {
        send: jest.fn(),
        getFrom: jest.fn(() => ({
            email: 'news@bitshala.org',
            name: 'Bitshala',
        })),
        getDefaultReplyTo: jest.fn(() => 'hello@bitshala.org'),
        usesDedicatedTransport: jest.fn(() => true),
    };
    const urlService = {
        getApiBaseUrl: () => 'https://api.test',
        getFrontendUrl: () => 'https://app.test',
    };
    const config: Record<string, unknown> = {
        'email.newsletter.dailyLimit': 1500,
        'email.newsletter.ratePerMinute': 30,
    };

    function audience(recipients: number, skipped = 0, invalid: string[] = []) {
        subscriptionService.resolveAudience.mockResolvedValue({
            recipients: Array.from({ length: recipients }, (_, i) => ({
                subscriberId: `s-${i}`,
                email: `a${i}@x.test`,
                name: null,
            })),
            skipped: Array.from({ length: skipped }, (_, i) => ({
                email: `gone${i}@x.test`,
                reason: 'Unsubscribed',
            })),
            invalid,
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        stored = makeNewsletter();
        newsletterRepository.findOne.mockImplementation(async () => ({
            ...stored,
        }));
        deliveryRepository.query.mockResolvedValue([]);
        dbTransactionService.execute.mockImplementation(
            (fn: (m: EntityManager) => Promise<unknown>) =>
                fn(manager as unknown as EntityManager),
        );
        manager.findOne.mockImplementation(async () => ({ ...stored }));
        manager.update.mockResolvedValue({ affected: 1 });
        sendService.countSentLast24h.mockResolvedValue(0);
        mailingListRepository.find.mockImplementation(
            async ({ where }: { where: { id: { value: string[] } } }) =>
                where.id.value.map((id) => list(id)),
        );
        audience(3);

        service = new NewslettersService(
            newsletterRepository as unknown as Repository<Newsletter>,
            deliveryRepository as unknown as Repository<NewsletterDelivery>,
            mailingListRepository as unknown as Repository<MailingList>,
            dbTransactionService as unknown as DbTransactionService,
            subscriptionService as unknown as SubscriptionService,
            renderService as unknown as NewsletterRenderService,
            sendService as unknown as NewsletterSendService,
            mailer as unknown as NewsletterMailerService,
            urlService as unknown as NewsletterUrlService,
            { get: (key: string) => config[key] } as unknown as ConfigService,
        );
    });

    describe('create', () => {
        it('creates a draft with defaults', async () => {
            await service.create({}, user);

            expect(newsletterRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Untitled newsletter',
                    contentFormat: NewsletterContentFormat.RICH_TEXT,
                    content: '',
                    lists: [],
                    adHocEmails: [],
                    trackingEnabled: false,
                    status: NewsletterStatus.DRAFT,
                    createdBy: user,
                }),
            );
        });

        it('normalises and de-duplicates ad-hoc addresses', async () => {
            await service.create(
                {
                    adHocEmails: [
                        ' Alice@Example.com ',
                        'alice@example.com',
                        '',
                        'bob@x.test',
                    ],
                },
                user,
            );
            expect(newsletterRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    adHocEmails: ['alice@example.com', 'bob@x.test'],
                }),
            );
        });

        it('rejects malformed ad-hoc addresses, naming them', async () => {
            await expect(
                service.create({ adHocEmails: ['ok@x.test', 'nope'] }, user),
            ).rejects.toThrow(/Invalid email address\(es\): nope/);
            expect(newsletterRepository.save).not.toHaveBeenCalled();
        });

        it('rejects unknown and archived lists', async () => {
            mailingListRepository.find.mockResolvedValueOnce([list('l-1')]);
            await expect(
                service.create({ listIds: ['l-1', 'l-2'] }, user),
            ).rejects.toBeInstanceOf(BadRequestException);

            mailingListRepository.find.mockResolvedValueOnce([
                list('l-1', { archivedAt: new Date(), name: 'Old' }),
            ]);
            await expect(
                service.create({ listIds: ['l-1'] }, user),
            ).rejects.toThrow(/Archived lists cannot be sent to: Old/);
        });
    });

    describe('update', () => {
        it('applies only the fields given; null clears', async () => {
            stored = makeNewsletter({ preheader: 'Old', subject: 'Keep' });

            await service.update('nl-1', {
                preheader: null,
                content: '<p>New</p>',
            });

            const [, saved] = manager.save.mock.calls[0];
            expect(saved).toMatchObject({
                subject: 'Keep',
                preheader: null,
                content: '<p>New</p>',
            });
            expect(manager.findOne).toHaveBeenCalledWith(Newsletter, {
                where: { id: 'nl-1' },
                lock: { mode: 'pessimistic_write' },
            });
        });

        it.each([
            NewsletterStatus.SCHEDULED,
            NewsletterStatus.SENDING,
            NewsletterStatus.SENT,
            NewsletterStatus.CANCELLED,
        ])('refuses a %s newsletter with 409', async (status) => {
            stored = makeNewsletter({ status });
            await expect(
                service.update('nl-1', { subject: 'x' }),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(manager.save).not.toHaveBeenCalled();
        });

        it('404s an unknown newsletter', async () => {
            manager.findOne.mockResolvedValueOnce(null);
            await expect(
                service.update('nl-x', { subject: 'x' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('remove', () => {
        it('deletes a draft', async () => {
            newsletterRepository.delete.mockResolvedValue({ affected: 1 });
            await service.remove('nl-1');
            expect(newsletterRepository.delete).toHaveBeenCalledWith({
                id: 'nl-1',
                status: NewsletterStatus.DRAFT,
            });
        });

        it('refuses anything else with 409', async () => {
            newsletterRepository.delete.mockResolvedValue({ affected: 0 });
            stored = makeNewsletter({ status: NewsletterStatus.SENT });
            await expect(service.remove('nl-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });
    });

    describe('send', () => {
        it('starts sending now', async () => {
            await service.send('nl-1', {});

            expect(manager.update).toHaveBeenCalledWith(
                Newsletter,
                { id: 'nl-1', status: NewsletterStatus.DRAFT },
                expect.objectContaining({
                    status: NewsletterStatus.SENDING,
                    scheduledAt: null,
                }),
            );
            const [id, at, txManager] = sendService.enqueue.mock.calls[0];
            expect(id).toBe('nl-1');
            expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5000);
            expect(txManager).toBe(manager);
            expect(subscriptionService.resolveAudience).toHaveBeenCalledWith(
                ['l-1'],
                [],
                { dryRun: true },
            );
        });

        it('schedules for a future time', async () => {
            const when = new Date(Date.now() + 3_600_000);
            await service.send('nl-1', { scheduledAt: when.toISOString() });

            expect(manager.update).toHaveBeenCalledWith(
                Newsletter,
                { id: 'nl-1', status: NewsletterStatus.DRAFT },
                expect.objectContaining({
                    status: NewsletterStatus.SCHEDULED,
                    scheduledAt: when,
                }),
            );
            expect(sendService.enqueue).toHaveBeenCalledWith(
                'nl-1',
                when,
                manager,
            );
        });

        it('rejects a time in the past', async () => {
            await expect(
                service.send('nl-1', {
                    scheduledAt: new Date(Date.now() - 60_000).toISOString(),
                }),
            ).rejects.toThrow(/already passed/);
            expect(sendService.enqueue).not.toHaveBeenCalled();
        });

        it.each([
            ['a blank subject', { subject: '   ' }, /subject/],
            [
                'an empty editor',
                { content: '<p></p><p> &nbsp;</p>' },
                /content/,
            ],
            [
                'an archived list',
                {
                    lists: [
                        list('l-1', { archivedAt: new Date(), name: 'Old' }),
                    ],
                },
                /archived list\(s\).*Old/,
            ],
        ])('rejects %s with 400', async (_label, overrides, message) => {
            stored = makeNewsletter(overrides as Partial<Newsletter>);
            await expect(service.send('nl-1', {})).rejects.toThrow(message);
            expect(manager.update).not.toHaveBeenCalled();
        });

        it('allows content that is only an image', async () => {
            stored = makeNewsletter({ content: '<img src="https://x/a.png">' });
            await expect(service.send('nl-1', {})).resolves.toBeDefined();
        });

        it('rejects unknown merge tags with 400, naming each once', async () => {
            stored = makeNewsletter({
                subject: 'Hi {{firstname}}',
                preheader: '{{ teaser }}',
                content: [
                    '<p>{{ first name }} {{firstname}} {{name}}</p>',
                    '<a href="https://x.test/?e=%7B%7Bemial%7D%7D">x</a>',
                ].join(''),
            });

            const error = await service.send('nl-1', {}).catch((e) => e);

            expect(error).toBeInstanceOf(BadRequestException);
            expect(error.message).toBe(
                'Unknown merge tag(s): {{firstname}}, {{ teaser }}, {{ first name }}, %7B%7Bemial%7D%7D. ' +
                    'Supported: {{name}}, {{first_name}}, {{email}}, {{unsubscribe_url}}, {{preferences_url}}.',
            );
            expect(manager.update).not.toHaveBeenCalled();
            expect(sendService.enqueue).not.toHaveBeenCalled();
        });

        it('accepts every supported tag, however it is spaced, cased or encoded', async () => {
            stored = makeNewsletter({
                subject: 'For {{ FIRST_NAME }}',
                content: [
                    '<p>{{name}} {{\n email \n}}</p>',
                    '<a href="{{ unsubscribe_url }}">u</a>',
                    '<a href="%7B%7B%20preferences_url%20%7D%7D">p</a>',
                ].join(''),
            });
            await expect(service.send('nl-1', {})).resolves.toBeDefined();
        });

        it.each([
            ['unclosed tags', '<'.repeat(300_000)],
            ['unclosed anchors', '<a '.repeat(100_000)],
            ['unclosed merge tags', '{{ x '.repeat(60_000)],
            ['unclosed encoded tags', '%7B%7B%20'.repeat(30_000)],
        ])('checks 300 KB of %s in linear time', async (_label, content) => {
            stored = makeNewsletter({ content });
            const started = performance.now();
            await service.send('nl-1', {});
            expect(performance.now() - started).toBeLessThan(500);
        });

        it('rejects an empty audience with 400', async () => {
            audience(0, 2);
            await expect(service.send('nl-1', {})).rejects.toThrow(
                /Nobody would receive/,
            );

            stored = makeNewsletter({ lists: [], adHocEmails: [] });
            await expect(service.send('nl-1', {})).rejects.toThrow(
                /Choose at least one list/,
            );
        });

        it('refuses a newsletter that is not a draft', async () => {
            stored = makeNewsletter({ status: NewsletterStatus.SCHEDULED });
            await expect(service.send('nl-1', {})).rejects.toBeInstanceOf(
                ConflictException,
            );
        });

        it('refuses the second of two concurrent sends', async () => {
            manager.update.mockResolvedValueOnce({ affected: 0 });
            await expect(service.send('nl-1', {})).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(sendService.enqueue).not.toHaveBeenCalled();
        });
    });

    describe('unschedule', () => {
        it('moves SCHEDULED back to DRAFT', async () => {
            newsletterRepository.update.mockResolvedValue({ affected: 1 });
            await service.unschedule('nl-1');
            expect(newsletterRepository.update).toHaveBeenCalledWith(
                { id: 'nl-1', status: NewsletterStatus.SCHEDULED },
                { status: NewsletterStatus.DRAFT, scheduledAt: null },
            );
        });

        it('refuses anything else with 409', async () => {
            newsletterRepository.update.mockResolvedValue({ affected: 0 });
            await expect(service.unschedule('nl-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });
    });

    describe('cancel', () => {
        it('cancels and skips every unsent delivery, in flight included', async () => {
            const deliveries = chain({ execute: { affected: 5 } });
            manager.createQueryBuilder.mockReturnValue(deliveries);

            await service.cancel('nl-1');

            expect(manager.update).toHaveBeenCalledWith(
                Newsletter,
                expect.objectContaining({ id: 'nl-1' }),
                expect.objectContaining({
                    status: NewsletterStatus.CANCELLED,
                    pausedUntil: null,
                }),
            );
            const calls = deliveries.calls as [string, unknown[]][];
            expect(calls).toContainEqual([
                'set',
                [
                    {
                        status: NewsletterDeliveryStatus.SKIPPED,
                        error: 'Cancelled',
                        claimedAt: null,
                    },
                ],
            ]);
            expect(calls).toContainEqual([
                'andWhere',
                [
                    'status IN (:...statuses)',
                    {
                        statuses: [
                            NewsletterDeliveryStatus.PENDING,
                            NewsletterDeliveryStatus.SENDING,
                        ],
                    },
                ],
            ]);
        });

        it('refuses a draft or finished newsletter with 409', async () => {
            manager.update.mockResolvedValueOnce({ affected: 0 });
            manager.exists.mockResolvedValueOnce(true);
            await expect(service.cancel('nl-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });
    });

    describe('retryFailed', () => {
        it('requeues failed deliveries and resumes sending', async () => {
            stored = makeNewsletter({ status: NewsletterStatus.SENT });
            // An UPDATE through manager.query resolves to [rows, affected].
            manager.query.mockResolvedValue([[], 2]);

            await service.retryFailed('nl-1');

            const [sql, params] = manager.query.mock.calls[0];
            expect(params).toEqual(['nl-1']);
            expect(sql).toContain(
                `SET "status" = '${NewsletterDeliveryStatus.PENDING}',`,
            );
            expect(sql).toContain(
                `AND d."status" = '${NewsletterDeliveryStatus.FAILED}'`,
            );
            // The send loop's own rule: still ACTIVE, and still on one of
            // its lists or an ad-hoc recipient.
            expect(sql).toContain(`AND (${DELIVERY_STILL_WANTED_SQL})`);
            expect(manager.update).toHaveBeenCalledWith(
                Newsletter,
                { id: 'nl-1' },
                expect.objectContaining({
                    status: NewsletterStatus.SENDING,
                    sentAt: null,
                }),
            );
            expect(sendService.enqueue).toHaveBeenCalledWith(
                'nl-1',
                expect.any(Date),
                manager,
            );
        });

        it.each([
            NewsletterStatus.DRAFT,
            NewsletterStatus.SCHEDULED,
            NewsletterStatus.CANCELLED,
        ])('refuses a %s newsletter with 409', async (status) => {
            stored = makeNewsletter({ status });
            await expect(service.retryFailed('nl-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });

        it('400s when nothing can be retried', async () => {
            stored = makeNewsletter({ status: NewsletterStatus.SENDING });
            manager.query.mockResolvedValue([[], 0]);
            await expect(service.retryFailed('nl-1')).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(sendService.enqueue).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('reads the stats for the whole page in one grouped query', async () => {
            const a = makeNewsletter({ id: 'a' });
            const b = makeNewsletter({ id: 'b', lists: [] });
            newsletterRepository.createQueryBuilder.mockReturnValue(
                chain({ getManyAndCount: [[a, b], 2] }),
            );
            deliveryRepository.query.mockResolvedValue([
                {
                    newsletterId: 'a',
                    status: 'SENT',
                    count: 5,
                    opened: 3,
                    clicked: 1,
                },
                {
                    newsletterId: 'a',
                    status: 'PENDING',
                    count: 2,
                    opened: 0,
                    clicked: 0,
                },
                {
                    newsletterId: 'a',
                    status: 'SENDING',
                    count: 1,
                    opened: 0,
                    clicked: 0,
                },
                {
                    newsletterId: 'a',
                    status: 'FAILED',
                    count: 1,
                    opened: 0,
                    clicked: 0,
                },
                {
                    newsletterId: 'a',
                    status: 'SKIPPED',
                    count: 4,
                    opened: 0,
                    clicked: 0,
                },
            ]);

            const page = await service.list({ page: 0, pageSize: 10 });

            expect(deliveryRepository.query).toHaveBeenCalledTimes(1);
            expect(deliveryRepository.query.mock.calls[0][1]).toEqual([
                ['a', 'b'],
            ]);
            expect(page.totalRecords).toBe(2);
            expect(page.records[0].stats).toEqual({
                total: 13,
                pending: 3,
                sent: 5,
                failed: 1,
                skipped: 4,
                opened: 3,
                clicked: 1,
            });
            expect(page.records[1].stats.total).toBe(0);
            expect(page.records[0]).toMatchObject({
                listNames: ['List l-1'],
                createdByName: 'Ada',
                createdAt: '2026-11-01T00:00:00.000Z',
            });
        });
    });

    describe('getAudience', () => {
        it('counts a dry run and estimates days under the daily limit', async () => {
            audience(4000, 12, ['bad']);
            sendService.countSentLast24h.mockResolvedValue(1000);

            const result = await service.getAudience('nl-1');

            expect(subscriptionService.resolveAudience).toHaveBeenCalledWith(
                ['l-1'],
                [],
                { dryRun: true },
            );
            // 500 left today, then 1,500 a day for the other 3,500.
            expect(result).toEqual({
                total: 4012,
                willSend: 4000,
                skipped: 12,
                invalidAdHoc: ['bad'],
                dailyLimit: 1500,
                sentLast24h: 1000,
                estimatedDays: 4,
            });
        });

        it('is one day when it fits today, zero when nobody would get it', async () => {
            audience(10);
            await expect(service.getAudience('nl-1')).resolves.toMatchObject({
                estimatedDays: 1,
            });
            audience(0);
            await expect(service.getAudience('nl-1')).resolves.toMatchObject({
                estimatedDays: 0,
            });
        });
    });

    describe('sendTest', () => {
        it('renders in test mode per address and reports each result', async () => {
            renderService.render.mockReturnValue({
                subject: '[TEST] Hello',
                html: '<p>x</p>',
                text: 'x',
                headers: {},
            });
            mailer.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(
                Object.assign(new Error('Invalid login'), {
                    code: 'EAUTH',
                }),
            );

            const result = await service.sendTest('nl-1', {
                emails: ['Me@x.test', 'me@x.test', 'you@x.test'],
            });

            expect(result).toEqual({
                sent: ['me@x.test'],
                failed: [
                    { email: 'you@x.test', error: 'EAUTH: Invalid login' },
                ],
            });
            expect(renderService.render).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'nl-1' }),
                expect.objectContaining({
                    email: 'me@x.test',
                    token: 'preview',
                }),
                { mode: 'test' },
            );
            expect(manager.update).not.toHaveBeenCalled();
            expect(
                deliveryRepository.createQueryBuilder,
            ).not.toHaveBeenCalled();
        });

        it('does not check merge tags, so a draft can be tried out', async () => {
            stored = makeNewsletter({ content: '<p>{{firstname}}</p>' });
            renderService.render.mockReturnValue({
                subject: '[TEST] Hello',
                html: '<p>{{firstname}}</p>',
                text: '{{firstname}}',
                headers: {},
            });
            mailer.send.mockResolvedValue(undefined);

            await expect(
                service.sendTest('nl-1', { emails: ['me@x.test'] }),
            ).resolves.toEqual({ sent: ['me@x.test'], failed: [] });
            await expect(service.preview('nl-1', {})).resolves.toBeDefined();
        });
    });

    describe('preview', () => {
        it('renders unsaved overrides for the sample recipient', async () => {
            renderService.render.mockReturnValue({
                subject: 'S',
                html: 'H',
                text: 'T',
                headers: { Precedence: 'bulk' },
            });

            const result = await service.preview('nl-1', {
                content: '<p>Draft</p>',
                preheader: null,
            });

            expect(result).toEqual({ subject: 'S', html: 'H', text: 'T' });
            expect(renderService.render).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Hello',
                    content: '<p>Draft</p>',
                    preheader: null,
                }),
                expect.objectContaining({ token: 'preview' }),
                { mode: 'preview' },
            );
        });
    });

    describe('duplicate', () => {
        it('copies into a new draft without archived lists', async () => {
            stored = makeNewsletter({
                status: NewsletterStatus.SENT,
                subject: 'Launch',
                lists: [list('l-1'), list('l-2', { archivedAt: new Date() })],
                adHocEmails: ['a@x.test'],
                trackingEnabled: true,
            });

            await service.duplicate('nl-1', user);

            expect(newsletterRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Copy of Launch',
                    status: NewsletterStatus.DRAFT,
                    lists: [expect.objectContaining({ id: 'l-1' })],
                    adHocEmails: ['a@x.test'],
                    trackingEnabled: true,
                    createdBy: user,
                }),
            );
        });
    });

    it('reports settings', async () => {
        sendService.countSentLast24h.mockResolvedValue(42);
        await expect(service.getSettings()).resolves.toEqual({
            fromEmail: 'news@bitshala.org',
            fromName: 'Bitshala',
            replyTo: 'hello@bitshala.org',
            dailyLimit: 1500,
            ratePerMinute: 30,
            sentLast24h: 42,
            usesDedicatedTransport: true,
            apiBaseUrl: 'https://api.test',
            frontendUrl: 'https://app.test',
        });
    });
});
