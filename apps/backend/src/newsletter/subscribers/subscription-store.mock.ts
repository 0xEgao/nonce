import 'jest';
import { FindOperator } from 'typeorm';
import {
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { Subscriber } from '@/entities/subscriber.entity';

type Row = Record<string, any>;

/**
 * A chainable QueryBuilder stand-in: every builder method is a jest.fn that
 * returns the builder, terminal methods resolve to `results` (or empty).
 */
export function queryBuilderMock(
    results: Record<string, unknown> = {},
): Record<string, jest.Mock> {
    const terminals: Record<string, unknown> = {
        getMany: [],
        getRawMany: [],
        getManyAndCount: [[], 0],
        getCount: 0,
        getOne: null,
        execute: { raw: [] },
        ...results,
    };
    const fns: Record<string, jest.Mock> = {};
    const qb: Record<string, jest.Mock> = new Proxy(fns, {
        get(target, prop) {
            // Not a thenable, or `await qb` would call it.
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            if (!target[prop]) {
                if (prop in terminals) {
                    target[prop] = jest.fn().mockResolvedValue(terminals[prop]);
                } else if (prop === 'getQuery') {
                    target[prop] = jest.fn().mockReturnValue('(subquery)');
                } else if (prop === 'subQuery') {
                    target[prop] = jest.fn(() => queryBuilderMock());
                } else {
                    target[prop] = jest.fn().mockReturnValue(qb);
                }
            }
            return target[prop];
        },
    });
    return qb;
}

/** The subset of TypeORM find-options `where` the services use. */
function matches(target: any, where: Row): boolean {
    return Object.entries(where).every(([key, expected]) => {
        const actual = target?.[key];
        if (expected instanceof FindOperator) {
            if (expected.type === 'in') {
                return (expected.value as unknown as unknown[]).includes(
                    actual,
                );
            }
            if (expected.type === 'isNull') return actual == null;
            if (expected.type === 'moreThan') {
                return actual != null && actual > expected.value;
            }
            throw new Error(`Unsupported operator ${expected.type}`);
        }
        if (
            expected !== null &&
            typeof expected === 'object' &&
            !(expected instanceof Date)
        ) {
            // A to-many relation matches when any related row does.
            return Array.isArray(actual)
                ? actual.some((item) => matches(item, expected))
                : matches(actual, expected);
        }
        return actual === expected;
    });
}

/**
 * Enough of a database for the subscription services: mailing lists,
 * subscribers, their rows and newsletters, with find/update/insert-or-ignore
 * semantics matching the real constraints (unique email; unique list +
 * subscriber).
 */
export class SubscriptionStore {
    lists: MailingList[] = [];
    subscribers: Subscriber[] = [];
    rows: MailingListSubscription[] = [];
    newsletters: Newsletter[] = [];
    /** Every insert-or-ignore, in order, with the values passed in. */
    inserts: { entity: unknown; values: Row[] }[] = [];

    private nextId = 1;

    readonly manager = {
        find: jest.fn(async (entity: unknown, options: Row = {}) =>
            this.findIn(entity, options.where),
        ),
        findOneOrFail: jest.fn(async (entity: unknown, options: Row) => {
            const [found] = this.findIn(entity, options.where);
            if (!found) throw new Error('EntityNotFound');
            return found;
        }),
        count: jest.fn(
            async (entity: unknown, options: Row = {}) =>
                this.findIn(entity, options.where).length,
        ),
        update: jest.fn(async (entity: unknown, criteria: Row, patch: Row) =>
            this.updateIn(entity, criteria, patch),
        ),
        createQueryBuilder: jest.fn(() => this.insertBuilder()),
        query: jest.fn(async (sql: string, params: unknown[]) => {
            // The bulk add's name fill-in.
            if (sql.includes('UPDATE "subscriber" SET "name"')) {
                const [ids, names] = params as [string[], string[]];
                ids.forEach((id, i) => {
                    const subscriber = this.subscribers.find(
                        (s) => s.id === id,
                    );
                    if (subscriber && subscriber.name === null) {
                        subscriber.name = names[i];
                    }
                });
                return [];
            }
            throw new Error(`Unexpected query: ${sql}`);
        }),
    };

    repository(entity: unknown) {
        return {
            manager: this.manager,
            find: jest.fn(async (options: Row = {}) =>
                this.findIn(entity, options.where),
            ),
            findOne: jest.fn(
                async (options: Row) =>
                    this.findIn(entity, options.where)[0] ?? null,
            ),
            findOneOrFail: jest.fn(async (options: Row) => {
                const [found] = this.findIn(entity, options.where);
                if (!found) throw new Error('EntityNotFound');
                return found;
            }),
            findOneByOrFail: jest.fn(async (where: Row) => {
                const [found] = this.findIn(entity, where);
                if (!found) throw new Error('EntityNotFound');
                return found;
            }),
            exists: jest.fn(
                async (options: Row) =>
                    this.findIn(entity, options.where).length > 0,
            ),
            count: jest.fn(
                async (options: Row = {}) =>
                    this.findIn(entity, options.where).length,
            ),
            update: jest.fn(async (criteria: Row, patch: Row) =>
                this.updateIn(entity, criteria, patch),
            ),
            delete: jest.fn(async (criteria: Row) => {
                const collection = this.collection(entity);
                const doomed = collection.filter((o) => matches(o, criteria));
                this.setCollection(
                    entity,
                    collection.filter((o) => !doomed.includes(o)),
                );
                return { affected: doomed.length, raw: [] };
            }),
            create: jest.fn((values: Row) => ({ ...values })),
            save: jest.fn(async (values: Row) => {
                if (!values.id) {
                    Object.assign(values, {
                        id: this.id('saved'),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    this.collection(entity).push(values);
                }
                return values;
            }),
            createQueryBuilder: jest.fn(() => queryBuilderMock()),
        };
    }

    addList(values: Partial<MailingList> = {}): MailingList {
        const list = {
            id: this.id('list'),
            name: 'List',
            slug: `list-${this.nextId}`,
            description: null,
            isPublic: true,
            archivedAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            ...values,
        } as MailingList;
        this.lists.push(list);
        return list;
    }

    addSubscriber(email: string, values: Partial<Subscriber> = {}): Subscriber {
        const subscriber = {
            id: this.id('subscriber'),
            email,
            name: null,
            token: `token-${email}`,
            status: SubscriberStatus.ACTIVE,
            statusReason: null,
            statusChangedAt: null,
            lastConfirmationSentAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            ...values,
        } as Subscriber;
        this.subscribers.push(subscriber);
        return subscriber;
    }

    addRow(
        list: MailingList,
        subscriber: Subscriber,
        status: SubscriptionStatus,
        values: Partial<MailingListSubscription> = {},
    ): MailingListSubscription {
        const row = {
            id: this.id('row'),
            list,
            subscriber,
            status,
            source: SubscriptionSource.ADMIN,
            confirmedAt: null,
            unsubscribedAt: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            ...values,
        } as MailingListSubscription;
        this.rows.push(row);
        return row;
    }

    addNewsletter(lists: MailingList[]): Newsletter {
        const newsletter = {
            id: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`,
            lists,
        } as Newsletter;
        this.newsletters.push(newsletter);
        return newsletter;
    }

    rowFor(
        list: MailingList,
        subscriber: Subscriber,
    ): MailingListSubscription | undefined {
        return this.rows.find(
            (row) =>
                row.list.id === list.id && row.subscriber.id === subscriber.id,
        );
    }

    findSubscriber(email: string): Subscriber | undefined {
        return this.subscribers.find((s) => s.email === email);
    }

    /** Throws when there is none, so a test fails at the lookup. */
    subscriberFor(email: string): Subscriber {
        const subscriber = this.findSubscriber(email);
        if (!subscriber) throw new Error(`No subscriber ${email}`);
        return subscriber;
    }

    insertedInto(entity: unknown): Row[] {
        return this.inserts
            .filter((insert) => insert.entity === entity)
            .flatMap((insert) => insert.values);
    }

    private id(prefix: string): string {
        return `${prefix}-${this.nextId++}`;
    }

    private collection(entity: unknown): Row[] {
        if (entity === Subscriber) return this.subscribers;
        if (entity === MailingListSubscription) return this.rows;
        if (entity === MailingList) return this.lists;
        if (entity === Newsletter) return this.newsletters;
        throw new Error(`No collection for ${String(entity)}`);
    }

    private setCollection(entity: unknown, values: Row[]): void {
        if (entity === Subscriber) this.subscribers = values as Subscriber[];
        else if (entity === MailingListSubscription) {
            this.rows = values as MailingListSubscription[];
        } else if (entity === MailingList) {
            this.lists = values as MailingList[];
        } else throw new Error(`No collection for ${String(entity)}`);
    }

    private findIn(entity: unknown, where: Row = {}): any[] {
        return this.collection(entity).filter((o) => matches(o, where));
    }

    private updateIn(entity: unknown, criteria: Row, patch: Row) {
        const targets = this.findIn(entity, criteria);
        for (const target of targets) Object.assign(target, patch);
        return { affected: targets.length, raw: [], generatedMaps: [] };
    }

    private insertBuilder() {
        const call: { entity: unknown; values: Row[] } = {
            entity: undefined,
            values: [],
        };
        const qb = queryBuilderMock();
        qb.into.mockImplementation((entity: unknown) => {
            call.entity = entity;
            return qb;
        });
        qb.values.mockImplementation((values: Row[]) => {
            call.values = values;
            return qb;
        });
        qb.execute.mockImplementation(async () => {
            this.inserts.push(call);
            const inserted = call.values
                .map((values) => this.insertOne(call.entity, values))
                .filter((row): row is Row => row !== null);
            return { raw: inserted.map((row) => ({ id: row.id })) };
        });
        return qb;
    }

    // ON CONFLICT DO NOTHING against the real unique constraints.
    private insertOne(entity: unknown, values: Row): Row | null {
        if (entity === Subscriber) {
            if (this.findSubscriber(values.email)) return null;
            return this.addSubscriber(values.email, {
                name: values.name ?? null,
                token: values.token,
            });
        }
        if (entity === MailingListSubscription) {
            const list =
                this.lists.find((l) => l.id === values.list.id) ??
                (values.list as MailingList);
            const subscriber = this.subscribers.find(
                (s) => s.id === values.subscriber.id,
            );
            if (!subscriber) throw new Error('FK violation: subscriber');
            if (this.rowFor(list, subscriber)) return null;
            return this.addRow(list, subscriber, values.status, {
                source: values.source,
                confirmedAt: values.confirmedAt ?? null,
            });
        }
        throw new Error(`Unexpected insert into ${String(entity)}`);
    }
}
