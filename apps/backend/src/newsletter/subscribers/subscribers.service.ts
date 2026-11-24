import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import type {
    ListSubscribersQuery,
    PaginatedData,
    SubscriberResponse,
    UpdateSubscriberRequest,
} from '@nonce/shared';
import { SubscriberStatus } from '@/common/enum';
import { escapeLikePattern } from '@/common/common';
import { PaginatedDataDto } from '@/common/dto';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { SubscriberResponseDto } from '@/newsletter/subscribers/subscribers.response.dto';

const ADMIN_STATUS_REASON = 'Changed by an admin';

@Injectable()
export class SubscribersService {
    constructor(
        @InjectRepository(Subscriber)
        private readonly subscriberRepository: Repository<Subscriber>,
        @InjectRepository(MailingListSubscription)
        private readonly subscriptionRepository: Repository<MailingListSubscription>,
    ) {}

    async list(
        query: ListSubscribersQuery,
    ): Promise<PaginatedData<SubscriberResponse>> {
        const qb = this.subscriberRepository.createQueryBuilder('subscriber');

        if (query.status) {
            qb.andWhere('subscriber.status = :status', {
                status: query.status,
            });
        }
        if (query.search) {
            qb.andWhere(
                new Brackets((w) =>
                    w
                        .where('subscriber.email ILIKE :search')
                        .orWhere('subscriber.name ILIKE :search'),
                ),
                { search: `%${escapeLikePattern(query.search)}%` },
            );
        }

        const [records, totalRecords] = await qb
            .orderBy('subscriber.createdAt', 'DESC')
            .addOrderBy('subscriber.id', 'ASC')
            .skip(query.page * query.pageSize)
            .take(query.pageSize)
            .getManyAndCount();

        const listCounts = await this.countLists(
            records.map((subscriber) => subscriber.id),
        );
        return new PaginatedDataDto({
            totalRecords,
            records: records.map(
                (subscriber) =>
                    new SubscriberResponseDto(
                        subscriber,
                        listCounts.get(subscriber.id) ?? 0,
                    ),
            ),
        });
    }

    async update(
        id: string,
        request: UpdateSubscriberRequest,
    ): Promise<SubscriberResponse> {
        const subscriber = await this.subscriberRepository.findOne({
            where: { id },
        });
        if (!subscriber) throw new NotFoundException('Subscriber not found');

        if (request.name !== undefined) {
            subscriber.name = request.name?.trim() || null;
        }
        if (request.status && request.status !== subscriber.status) {
            subscriber.status = request.status;
            subscriber.statusReason =
                request.status === SubscriberStatus.ACTIVE
                    ? null
                    : ADMIN_STATUS_REASON;
            subscriber.statusChangedAt = new Date();
        }
        await this.subscriberRepository.save(subscriber);

        const listCount = await this.subscriptionRepository.count({
            where: { subscriber: { id } },
        });
        return new SubscriberResponseDto(subscriber, listCount);
    }

    /**
     * Erases the address and every subscription it has. Past deliveries keep
     * their copy of the email for the send history; their link to the
     * subscriber is nulled by the foreign key.
     */
    async remove(id: string): Promise<void> {
        const result = await this.subscriberRepository.delete({ id });
        if (!result.affected) {
            throw new NotFoundException('Subscriber not found');
        }
    }

    /** One grouped query for the whole page, rows in any status. */
    private async countLists(
        subscriberIds: string[],
    ): Promise<Map<string, number>> {
        if (subscriberIds.length === 0) return new Map();
        const rows = await this.subscriptionRepository
            .createQueryBuilder('subscription')
            .select('subscription."subscriberId"', 'subscriberId')
            .addSelect('COUNT(*)', 'listCount')
            .where('subscription."subscriberId" IN (:...subscriberIds)', {
                subscriberIds,
            })
            .groupBy('subscription."subscriberId"')
            .getRawMany<{ subscriberId: string; listCount: string }>();
        // COUNT is a bigint, which the driver hands back as a string.
        return new Map(
            rows.map((row) => [row.subscriberId, Number(row.listCount)]),
        );
    }
}
