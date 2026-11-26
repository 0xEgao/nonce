import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SubscriberStatus, SubscriptionStatus } from '@/common/enum';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { SubscribersService } from '@/newsletter/subscribers/subscribers.service';
import {
    queryBuilderMock,
    SubscriptionStore,
} from '@/newsletter/subscribers/subscription-store.mock';

describe('SubscribersService', () => {
    let service: SubscribersService;
    let store: SubscriptionStore;
    let subscriberRepository: ReturnType<SubscriptionStore['repository']>;
    let subscriptionRepository: ReturnType<SubscriptionStore['repository']>;

    beforeEach(async () => {
        store = new SubscriptionStore();
        subscriberRepository = store.repository(Subscriber);
        subscriptionRepository = store.repository(MailingListSubscription);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SubscribersService,
                {
                    provide: getRepositoryToken(Subscriber),
                    useValue: subscriberRepository,
                },
                {
                    provide: getRepositoryToken(MailingListSubscription),
                    useValue: subscriptionRepository,
                },
            ],
        }).compile();

        service = module.get(SubscribersService);
    });

    it('lists a page with list counts from one grouped query', async () => {
        const alice = store.addSubscriber('alice@example.com');
        const bob = store.addSubscriber('bob@example.com');
        subscriberRepository.createQueryBuilder.mockReturnValue(
            queryBuilderMock({ getManyAndCount: [[alice, bob], 2] }),
        );
        subscriptionRepository.createQueryBuilder.mockReturnValue(
            queryBuilderMock({
                getRawMany: [{ subscriberId: alice.id, listCount: '3' }],
            }),
        );

        const result = await service.list({ page: 0, pageSize: 10 });

        expect(result.totalRecords).toBe(2);
        expect(result.records.map((r) => [r.email, r.listCount])).toEqual([
            ['alice@example.com', 3],
            ['bob@example.com', 0],
        ]);
        expect(subscriptionRepository.createQueryBuilder).toHaveBeenCalledTimes(
            1,
        );
    });

    it('records when and why an admin suppresses an address', async () => {
        const alice = store.addSubscriber('alice@example.com');
        store.addRow(store.addList(), alice, SubscriptionStatus.SUBSCRIBED);

        const result = await service.update(alice.id, {
            status: SubscriberStatus.UNSUBSCRIBED,
            name: '  ',
        });

        expect(result).toMatchObject({
            status: SubscriberStatus.UNSUBSCRIBED,
            statusReason: 'Changed by an admin',
            name: null,
            listCount: 1,
        });
        expect(alice.statusChangedAt).toBeInstanceOf(Date);
    });

    it('clears the reason when reactivating', async () => {
        const alice = store.addSubscriber('alice@example.com', {
            status: SubscriberStatus.BOUNCED,
            statusReason: '550 user unknown',
        });

        await service.update(alice.id, { status: SubscriberStatus.ACTIVE });

        expect(alice).toMatchObject({
            status: SubscriberStatus.ACTIVE,
            statusReason: null,
        });
    });

    it('a rename does not write back a status changed since the read', async () => {
        const alice = store.addSubscriber('alice@example.com');
        const unsubscribedAt = new Date('2026-03-01T00:00:00Z');
        // The read sees Alice ACTIVE; she unsubscribes before the write.
        subscriberRepository.findOne.mockImplementationOnce(async () => {
            const snapshot = { ...alice };
            Object.assign(alice, {
                status: SubscriberStatus.UNSUBSCRIBED,
                statusReason: 'Unsubscribed from all lists',
                statusChangedAt: unsubscribedAt,
            });
            return snapshot;
        });

        const result = await service.update(alice.id, { name: ' Alice ' });

        expect(alice).toMatchObject({
            name: 'Alice',
            status: SubscriberStatus.UNSUBSCRIBED,
            statusReason: 'Unsubscribed from all lists',
            statusChangedAt: unsubscribedAt,
        });
        expect(result.name).toBe('Alice');
        expect(subscriberRepository.save).not.toHaveBeenCalled();
    });

    it('writes nothing for an empty edit', async () => {
        const alice = store.addSubscriber('alice@example.com');

        const result = await service.update(alice.id, {});

        expect(subscriberRepository.update).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            email: 'alice@example.com',
            status: SubscriberStatus.ACTIVE,
        });
    });

    it('deletes a subscriber', async () => {
        const alice = store.addSubscriber('alice@example.com');

        await service.remove(alice.id);

        expect(store.subscribers).toHaveLength(0);
        await expect(service.remove(alice.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });
});
