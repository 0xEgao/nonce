import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import {
    Brackets,
    EntityManager,
    In,
    IsNull,
    QueryFailedError,
    Repository,
} from 'typeorm';
import type {
    AddPortalUsersRequest,
    AddSubscribersRequest,
    AddSubscribersResponse,
    CreateMailingListRequest,
    ListMailingListSubscribersQuery,
    ListMailingListsQuery,
    ListSubscriberResponse,
    MailingListResponse,
    PaginatedData,
    UpdateMailingListRequest,
} from '@nonce/shared';
import {
    PortalAudience,
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { escapeLikePattern } from '@/common/common';
import { PaginatedDataDto } from '@/common/dto';
import { Cohort } from '@/entities/cohort.entity';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import {
    ListSubscriberResponseDto,
    MailingListCounts,
    MailingListResponseDto,
} from '@/newsletter/mailing-lists.response.dto';
import {
    generateSubscriberToken,
    slugify,
} from '@/newsletter/newsletter.utils';
import {
    chunk,
    decideImport,
    ImportCounts,
    ImportEntry,
    insertIgnoringConflicts,
    partitionEntries,
    toCsv,
} from '@/newsletter/subscription.util';

export interface MailingListCsvExport {
    fileName: string;
    /** `email,name,status,source,subscribedAt`, one row per subscription. */
    content: string;
}

const UNIQUE_VIOLATION = '23505';

// Addresses handled per round of reads and writes in a bulk add. Keeps every
// statement well under Postgres' 65,535 bind parameters.
const IMPORT_CHUNK_SIZE = 1000;

interface ImportPlan {
    counts: ImportCounts;
    /** Addresses with no subscriber yet: create both it and its row. */
    create: ImportEntry[];
    insertRowFor: string[];
    promoteRows: string[];
    reactivate: string[];
    fillNames: { id: string; name: string }[];
}

@Injectable()
export class MailingListsService {
    constructor(
        @InjectRepository(MailingList)
        private readonly listRepository: Repository<MailingList>,
        @InjectRepository(MailingListSubscription)
        private readonly subscriptionRepository: Repository<MailingListSubscription>,
        @InjectRepository(Newsletter)
        private readonly newsletterRepository: Repository<Newsletter>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Cohort)
        private readonly cohortRepository: Repository<Cohort>,
        private readonly dbTransactionService: DbTransactionService,
    ) {}

    async list(query: ListMailingListsQuery): Promise<MailingListResponse[]> {
        const lists = await this.listRepository.find({
            where: query.includeArchived ? {} : { archivedAt: IsNull() },
            order: { name: 'ASC' },
        });
        const counts = await this.countSubscriptions(
            lists.map((list) => list.id),
        );
        return lists.map(
            (list) => new MailingListResponseDto(list, counts.get(list.id)),
        );
    }

    async create(
        request: CreateMailingListRequest,
    ): Promise<MailingListResponse> {
        const name = request.name.trim();
        // slugify() keeps ASCII only, so a name in another script derives
        // nothing usable.
        const slug =
            request.slug ||
            slugify(name) ||
            `list-${randomBytes(3).toString('hex')}`;

        if (await this.listRepository.exists({ where: { slug } })) {
            throw this.slugConflict(slug);
        }

        try {
            const list = await this.listRepository.save(
                this.listRepository.create({
                    name,
                    slug,
                    description: request.description?.trim() || null,
                    isPublic: request.isPublic ?? false,
                    archivedAt: null,
                }),
            );
            return new MailingListResponseDto(list);
        } catch (error) {
            if (isUniqueViolation(error)) throw this.slugConflict(slug);
            throw error;
        }
    }

    async get(id: string): Promise<MailingListResponse> {
        const list = await this.findListOrFail(id);
        const counts = await this.countSubscriptions([id]);
        return new MailingListResponseDto(list, counts.get(id));
    }

    async update(
        id: string,
        request: UpdateMailingListRequest,
    ): Promise<MailingListResponse> {
        const list = await this.findListOrFail(id);
        if (request.name !== undefined) list.name = request.name.trim();
        if (request.description !== undefined) {
            list.description = request.description?.trim() || null;
        }
        if (request.isPublic !== undefined) list.isPublic = request.isPublic;
        if (request.archived !== undefined) {
            list.archivedAt = request.archived
                ? (list.archivedAt ?? new Date())
                : null;
        }
        await this.listRepository.save(list);
        return this.get(id);
    }

    async remove(id: string): Promise<void> {
        await this.findListOrFail(id);
        // The join table cascades, so deleting would silently drop the list
        // from those newsletters, sent ones included.
        const newsletters = await this.newsletterRepository.count({
            where: { lists: { id } },
        });
        if (newsletters > 0) {
            throw new ConflictException(
                `This list is used by ${newsletters} newsletter${newsletters === 1 ? '' : 's'}. Archive it instead.`,
            );
        }
        await this.listRepository.delete({ id });
    }

    async listSubscribers(
        id: string,
        query: ListMailingListSubscribersQuery,
    ): Promise<PaginatedData<ListSubscriberResponse>> {
        await this.findListOrFail(id);

        const qb = this.subscriptionRepository
            .createQueryBuilder('subscription')
            .innerJoinAndSelect('subscription.subscriber', 'subscriber')
            .where('subscription.list = :id', { id });

        if (query.status) {
            qb.andWhere('subscription.status = :status', {
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

        const [rows, totalRecords] = await qb
            .orderBy('subscription.createdAt', 'DESC')
            .addOrderBy('subscription.id', 'ASC')
            .skip(query.page * query.pageSize)
            .take(query.pageSize)
            .getManyAndCount();

        return new PaginatedDataDto({
            totalRecords,
            records: rows.map((row) => new ListSubscriberResponseDto(row)),
        });
    }

    async addSubscribers(
        id: string,
        request: AddSubscribersRequest,
    ): Promise<AddSubscribersResponse> {
        await this.findListOrFail(id);
        const { valid, invalid } = partitionEntries(request.subscribers);
        const counts = await this.subscribeInBulk(
            id,
            valid,
            SubscriptionSource.ADMIN,
            { resubscribe: request.resubscribe === true, dryRun: false },
        );
        return { ...counts, invalid };
    }

    async addPortalUsers(
        id: string,
        request: AddPortalUsersRequest,
    ): Promise<AddSubscribersResponse> {
        await this.findListOrFail(id);
        const users = await this.findPortalUsers(request);
        const { valid, invalid } = partitionEntries(
            users.map((user) => ({
                // The query only returns users with an email.
                email: user.email ?? '',
                name: user.displayName,
            })),
        );
        const counts = await this.subscribeInBulk(
            id,
            valid,
            SubscriptionSource.PORTAL_USERS,
            {
                resubscribe: request.resubscribe === true,
                dryRun: request.dryRun === true,
            },
        );
        return { ...counts, invalid };
    }

    async removeSubscription(
        id: string,
        subscriptionId: string,
    ): Promise<void> {
        const exists = await this.subscriptionRepository.exists({
            where: { id: subscriptionId, list: { id } },
        });
        if (!exists) throw new NotFoundException('Subscription not found');
        await this.subscriptionRepository.delete({ id: subscriptionId });
    }

    async exportSubscribers(id: string): Promise<MailingListCsvExport> {
        const list = await this.findListOrFail(id);
        const rows = await this.subscriptionRepository.find({
            where: { list: { id } },
            relations: { subscriber: true },
            order: { createdAt: 'ASC' },
        });
        const date = new Date().toISOString().slice(0, 10);
        return {
            fileName: `${list.slug}-subscribers-${date}.csv`,
            content: toCsv([
                ['email', 'name', 'status', 'source', 'subscribedAt'],
                ...rows.map((row) => [
                    row.subscriber.email,
                    row.subscriber.name,
                    row.status,
                    row.source,
                    row.confirmedAt?.toISOString() ?? null,
                ]),
            ]),
        };
    }

    // --- Internals ---

    private async findListOrFail(id: string): Promise<MailingList> {
        const list = await this.listRepository.findOne({ where: { id } });
        if (!list) throw new NotFoundException('Mailing list not found');
        return list;
    }

    private slugConflict(slug: string): ConflictException {
        return new ConflictException(
            `Another list already uses the slug "${slug}"`,
        );
    }

    /**
     * One grouped query for every list asked about. `subscriberCount` is who a
     * send would reach: SUBSCRIBED rows whose address is not suppressed.
     */
    private async countSubscriptions(
        listIds: string[],
    ): Promise<Map<string, MailingListCounts>> {
        if (listIds.length === 0) return new Map();
        const rows = await this.subscriptionRepository
            .createQueryBuilder('subscription')
            .innerJoin('subscription.subscriber', 'subscriber')
            .select('subscription."listId"', 'listId')
            .addSelect(
                'COUNT(*) FILTER (WHERE subscription.status = :subscribed AND subscriber.status = :active)',
                'subscriberCount',
            )
            .addSelect(
                'COUNT(*) FILTER (WHERE subscription.status = :pending)',
                'pendingCount',
            )
            .addSelect(
                'COUNT(*) FILTER (WHERE subscription.status = :unsubscribed)',
                'unsubscribedCount',
            )
            .where('subscription."listId" IN (:...listIds)', { listIds })
            .groupBy('subscription."listId"')
            .setParameters({
                subscribed: SubscriptionStatus.SUBSCRIBED,
                pending: SubscriptionStatus.PENDING,
                unsubscribed: SubscriptionStatus.UNSUBSCRIBED,
                active: SubscriberStatus.ACTIVE,
            })
            .getRawMany<{
                listId: string;
                subscriberCount: string;
                pendingCount: string;
                unsubscribedCount: string;
            }>();

        // COUNT is a bigint, which the driver hands back as a string.
        return new Map(
            rows.map((row) => [
                row.listId,
                {
                    subscriberCount: Number(row.subscriberCount),
                    pendingCount: Number(row.pendingCount),
                    unsubscribedCount: Number(row.unsubscribedCount),
                },
            ]),
        );
    }

    private async findPortalUsers(
        request: AddPortalUsersRequest,
    ): Promise<User[]> {
        const qb = this.userRepository
            .createQueryBuilder('user')
            .where('user.email IS NOT NULL');

        switch (request.audience) {
            case PortalAudience.ALL_USERS:
                break;
            case PortalAudience.COHORT_MEMBERS: {
                if (!request.cohortId) {
                    throw new BadRequestException(
                        'cohortId is required for COHORT_MEMBERS',
                    );
                }
                const cohortExists = await this.cohortRepository.exists({
                    where: { id: request.cohortId },
                });
                if (!cohortExists) {
                    throw new NotFoundException('Cohort not found');
                }
                qb.innerJoin(
                    'user.cohortMemberships',
                    'membership',
                    'membership.cohort = :cohortId',
                    { cohortId: request.cohortId },
                );
                break;
            }
            case PortalAudience.COHORT_TYPE_MEMBERS:
                if (!request.cohortType) {
                    throw new BadRequestException(
                        'cohortType is required for COHORT_TYPE_MEMBERS',
                    );
                }
                qb.innerJoin('user.cohortMemberships', 'membership').innerJoin(
                    'membership.cohort',
                    'cohort',
                    'cohort.type = :cohortType',
                    { cohortType: request.cohortType },
                );
                break;
            case PortalAudience.WAITLIST:
                if (request.cohortType) {
                    qb.innerJoin(
                        'user.cohortsWaitlist',
                        'waitlist',
                        'waitlist.type = :cohortType',
                        { cohortType: request.cohortType },
                    );
                } else {
                    qb.innerJoin('user.cohortsWaitlist', 'waitlist');
                }
                break;
            case PortalAudience.FELLOWS:
                qb.innerJoin('user.fellowships', 'fellowship');
                break;
        }

        // A user in several matching cohorts comes back once: TypeORM folds
        // joined rows into one entity per id.
        return qb.orderBy('user.createdAt', 'ASC').getMany();
    }

    /**
     * Adds every entry to the list as SUBSCRIBED, except addresses that
     * unsubscribed or are suppressed (unless `resubscribe`). Reads and writes
     * a chunk of addresses at a time, all in one transaction; a dry run only
     * reads.
     */
    private async subscribeInBulk(
        listId: string,
        entries: ImportEntry[],
        source: SubscriptionSource,
        options: { resubscribe: boolean; dryRun: boolean },
    ): Promise<ImportCounts> {
        const counts: ImportCounts = {
            added: 0,
            alreadySubscribed: 0,
            skippedUnsubscribed: 0,
            skippedSuppressed: 0,
        };
        const run = async (manager: EntityManager) => {
            for (const batch of chunk(entries, IMPORT_CHUNK_SIZE)) {
                const plan = await this.planImport(
                    manager,
                    listId,
                    batch,
                    options.resubscribe,
                );
                if (!options.dryRun) {
                    await this.applyImport(manager, listId, plan, source);
                }
                for (const key of Object.keys(
                    counts,
                ) as (keyof ImportCounts)[]) {
                    counts[key] += plan.counts[key];
                }
            }
        };

        if (options.dryRun) await run(this.subscriptionRepository.manager);
        else await this.dbTransactionService.execute(run);
        return counts;
    }

    private async planImport(
        manager: EntityManager,
        listId: string,
        batch: ImportEntry[],
        resubscribe: boolean,
    ): Promise<ImportPlan> {
        const subscribers = await manager.find(Subscriber, {
            where: { email: In(batch.map((entry) => entry.email)) },
        });
        const rows =
            subscribers.length === 0
                ? []
                : await manager.find(MailingListSubscription, {
                      where: {
                          list: { id: listId },
                          subscriber: {
                              id: In(subscribers.map((s) => s.id)),
                          },
                      },
                      relations: { subscriber: true },
                  });
        const subscriberByEmail = new Map(
            subscribers.map((subscriber) => [subscriber.email, subscriber]),
        );
        const rowBySubscriber = new Map(
            rows.map((row) => [row.subscriber.id, row]),
        );

        const plan: ImportPlan = {
            counts: {
                added: 0,
                alreadySubscribed: 0,
                skippedUnsubscribed: 0,
                skippedSuppressed: 0,
            },
            create: [],
            insertRowFor: [],
            promoteRows: [],
            reactivate: [],
            fillNames: [],
        };
        for (const entry of batch) {
            const subscriber = subscriberByEmail.get(entry.email);
            const row = subscriber
                ? rowBySubscriber.get(subscriber.id)
                : undefined;
            const decision = decideImport(subscriber, row, resubscribe);
            plan.counts[decision.outcome] += 1;

            if (!subscriber) {
                plan.create.push(entry);
                continue;
            }
            if (decision.row === 'insert')
                plan.insertRowFor.push(subscriber.id);
            if (decision.row === 'promote' && row)
                plan.promoteRows.push(row.id);
            if (decision.reactivate) plan.reactivate.push(subscriber.id);
            const leftAlone =
                decision.outcome === 'skippedSuppressed' ||
                decision.outcome === 'skippedUnsubscribed';
            if (!leftAlone && entry.name && !subscriber.name) {
                plan.fillNames.push({ id: subscriber.id, name: entry.name });
            }
        }
        return plan;
    }

    private async applyImport(
        manager: EntityManager,
        listId: string,
        plan: ImportPlan,
        source: SubscriptionSource,
    ): Promise<void> {
        const now = new Date();

        let createdIds: string[] = [];
        if (plan.create.length > 0) {
            await insertIgnoringConflicts(
                manager,
                Subscriber,
                plan.create.map((entry) => ({
                    email: entry.email,
                    name: entry.name,
                    token: generateSubscriberToken(),
                })),
            );
            const created = await manager.find(Subscriber, {
                where: { email: In(plan.create.map((entry) => entry.email)) },
            });
            createdIds = created.map((subscriber) => subscriber.id);
        }

        const rowSubscriberIds = [...plan.insertRowFor, ...createdIds];
        const inserted = await insertIgnoringConflicts(
            manager,
            MailingListSubscription,
            rowSubscriberIds.map((subscriberId) => ({
                list: { id: listId },
                subscriber: { id: subscriberId },
                status: SubscriptionStatus.SUBSCRIBED,
                source,
                confirmedAt: now,
            })),
        );
        // A row that appeared since the plan was read (a concurrent sign-up
        // or add) was left as it was, so it was not added by this request.
        const raced = rowSubscriberIds.length - inserted;
        if (raced > 0) {
            plan.counts.added -= raced;
            plan.counts.alreadySubscribed += raced;
        }

        if (plan.promoteRows.length > 0) {
            await manager.update(
                MailingListSubscription,
                { id: In(plan.promoteRows) },
                {
                    status: SubscriptionStatus.SUBSCRIBED,
                    confirmedAt: now,
                    unsubscribedAt: null,
                },
            );
        }
        if (plan.reactivate.length > 0) {
            await manager.update(
                Subscriber,
                { id: In(plan.reactivate) },
                {
                    status: SubscriberStatus.ACTIVE,
                    statusReason: null,
                    statusChangedAt: now,
                },
            );
        }
        if (plan.fillNames.length > 0) {
            await manager.query(
                `UPDATE "subscriber" SET "name" = "data"."name", "updatedAt" = now()
                 FROM unnest($1::uuid[], $2::varchar[]) AS "data"("id", "name")
                 WHERE "subscriber"."id" = "data"."id" AND "subscriber"."name" IS NULL`,
                [
                    plan.fillNames.map((fill) => fill.id),
                    plan.fillNames.map((fill) => fill.name),
                ],
            );
        }
    }
}

function isUniqueViolation(error: unknown): boolean {
    return (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === UNIQUE_VIOLATION
    );
}
