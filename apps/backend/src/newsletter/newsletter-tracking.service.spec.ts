import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { NewsletterTrackingService } from '@/newsletter/newsletter-tracking.service';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';

const DELIVERY_ID = '9b1f3c52-2f3e-4b0e-8a57-6d2c1e4f7a90';

describe('NewsletterTrackingService', () => {
    let service: NewsletterTrackingService;

    const queryBuilder = {
        innerJoin: jest.fn(),
        select: jest.fn(),
        where: jest.fn(),
        getRawOne: jest.fn(),
    };
    const deliveryRepository = {
        update: jest.fn(),
        createQueryBuilder: jest.fn(),
    };

    // The SET clause of the recorded update, with the raw-SQL fragments run.
    const updatedColumns = () => {
        const [criteria, values] = deliveryRepository.update.mock.calls[0];
        const sql = Object.fromEntries(
            Object.entries(values as Record<string, () => string>).map(
                ([column, fragment]) => [column, fragment()],
            ),
        );
        return { criteria, sql };
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        queryBuilder.innerJoin.mockReturnValue(queryBuilder);
        queryBuilder.select.mockReturnValue(queryBuilder);
        queryBuilder.where.mockReturnValue(queryBuilder);
        deliveryRepository.createQueryBuilder.mockReturnValue(queryBuilder);
        deliveryRepository.update.mockResolvedValue({ affected: 1 });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NewsletterTrackingService,
                {
                    provide: getRepositoryToken(NewsletterDelivery),
                    useValue: deliveryRepository,
                },
            ],
        }).compile();

        service = module.get(NewsletterTrackingService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('recordOpen', () => {
        it('bumps the counter and keeps the first open time in one statement', async () => {
            await service.recordOpen(DELIVERY_ID);

            expect(deliveryRepository.update).toHaveBeenCalledTimes(1);
            const { criteria, sql } = updatedColumns();
            expect(criteria).toEqual({ id: DELIVERY_ID });
            expect(sql).toEqual({
                openCount: '"openCount" + 1',
                openedAt: 'COALESCE("openedAt", now())',
            });
        });

        it('reads nothing first, so concurrent opens cannot lose a count', async () => {
            await service.recordOpen(DELIVERY_ID);

            expect(
                deliveryRepository.createQueryBuilder,
            ).not.toHaveBeenCalled();
        });

        it('does nothing for an id that is not a uuid', async () => {
            await service.recordOpen('not-a-uuid');
            await service.recordOpen('');
            await service.recordOpen("1'; DROP TABLE newsletter_delivery;--");

            expect(deliveryRepository.update).not.toHaveBeenCalled();
        });

        it('does not reject for an unknown delivery', async () => {
            deliveryRepository.update.mockResolvedValue({ affected: 0 });

            await expect(
                service.recordOpen(DELIVERY_ID),
            ).resolves.toBeUndefined();
        });

        it('does not reject when the write fails', async () => {
            deliveryRepository.update.mockRejectedValue(
                new Error('connection terminated'),
            );

            await expect(
                service.recordOpen(DELIVERY_ID),
            ).resolves.toBeUndefined();
            expect(Logger.prototype.warn).toHaveBeenCalledWith(
                expect.stringContaining('connection terminated'),
            );
        });
    });

    describe('recordClick', () => {
        const links = [
            'https://first.example/',
            'http://second.example/path?a=1&b=2',
        ];

        beforeEach(() => {
            queryBuilder.getRawOne.mockResolvedValue({ trackedLinks: links });
        });

        it('returns the stored link and counts the click as an open too', async () => {
            await expect(service.recordClick(DELIVERY_ID, 1)).resolves.toBe(
                links[1],
            );

            expect(queryBuilder.where).toHaveBeenCalledWith(
                'delivery.id = :id',
                { id: DELIVERY_ID },
            );
            expect(deliveryRepository.update).toHaveBeenCalledTimes(1);
            const { criteria, sql } = updatedColumns();
            expect(criteria).toEqual({ id: DELIVERY_ID });
            expect(sql).toEqual({
                clickCount: '"clickCount" + 1',
                firstClickedAt: 'COALESCE("firstClickedAt", now())',
                openedAt: 'COALESCE("openedAt", now())',
            });
        });

        it('looks the link up in the newsletter of that delivery', async () => {
            await service.recordClick(DELIVERY_ID, 0);

            expect(deliveryRepository.createQueryBuilder).toHaveBeenCalledWith(
                'delivery',
            );
            expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
                'delivery.newsletter',
                'newsletter',
            );
            expect(queryBuilder.select).toHaveBeenCalledWith(
                'newsletter.trackedLinks',
                'trackedLinks',
            );
        });

        it('returns null and counts nothing for an unknown delivery', async () => {
            queryBuilder.getRawOne.mockResolvedValue(undefined);

            await expect(
                service.recordClick(DELIVERY_ID, 0),
            ).resolves.toBeNull();
            expect(deliveryRepository.update).not.toHaveBeenCalled();
        });

        it.each([['not-a-uuid'], [''], ["1' OR '1'='1"], ['../../etc/passwd']])(
            'returns null for the delivery id %j without querying',
            async (id) => {
                await expect(service.recordClick(id, 0)).resolves.toBeNull();

                expect(
                    deliveryRepository.createQueryBuilder,
                ).not.toHaveBeenCalled();
                expect(deliveryRepository.update).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['out of range', 2],
            ['far out of range', 1_000_000],
            ['negative', -1],
            ['fractional', 1.5],
            ['NaN', Number.NaN],
            ['infinite', Number.POSITIVE_INFINITY],
        ])(
            'returns null and counts nothing for a %s index',
            async (_name, index) => {
                await expect(
                    service.recordClick(DELIVERY_ID, index),
                ).resolves.toBeNull();

                expect(deliveryRepository.update).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['javascript:alert(document.cookie)'],
            ['data:text/html,<script>alert(1)</script>'],
            ['mailto:someone@example.com'],
            ['ftp://files.example/x'],
            ['/relative/path'],
            ['//evil.example/protocol-relative'],
            ['https:evil.example'],
            ['not a url'],
            [''],
        ])(
            'returns null for a stored value that is not an http(s) url: %j',
            async (stored) => {
                queryBuilder.getRawOne.mockResolvedValue({
                    trackedLinks: ['https://ok.example/', stored],
                });

                await expect(
                    service.recordClick(DELIVERY_ID, 1),
                ).resolves.toBeNull();
                expect(deliveryRepository.update).not.toHaveBeenCalled();
            },
        );

        it.each([
            ['a number', 42],
            ['null', null],
            ['an object', { url: 'https://x.example/' }],
            ['an array', ['https://x.example/']],
        ])(
            'returns null when the stored value is %s',
            async (_name, stored) => {
                queryBuilder.getRawOne.mockResolvedValue({
                    trackedLinks: [stored],
                });

                await expect(
                    service.recordClick(DELIVERY_ID, 0),
                ).resolves.toBeNull();
                expect(deliveryRepository.update).not.toHaveBeenCalled();
            },
        );

        it('returns null when the newsletter has no usable link list', async () => {
            for (const trackedLinks of [null, undefined, {}, 'https://x/']) {
                queryBuilder.getRawOne.mockResolvedValue({ trackedLinks });

                await expect(
                    service.recordClick(DELIVERY_ID, 0),
                ).resolves.toBeNull();
            }
            expect(deliveryRepository.update).not.toHaveBeenCalled();
        });

        it('still returns the link when the counters cannot be written', async () => {
            deliveryRepository.update.mockRejectedValue(
                new Error('deadlock detected'),
            );

            await expect(service.recordClick(DELIVERY_ID, 0)).resolves.toBe(
                links[0],
            );
            expect(Logger.prototype.warn).toHaveBeenCalledWith(
                expect.stringContaining('deadlock detected'),
            );
        });

        it('lets a failed lookup propagate rather than guess a destination', async () => {
            queryBuilder.getRawOne.mockRejectedValue(new Error('db down'));

            await expect(service.recordClick(DELIVERY_ID, 0)).rejects.toThrow(
                'db down',
            );
        });
    });
});
