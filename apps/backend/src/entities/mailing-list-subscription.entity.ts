import {
    Column,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { MailingList } from '@/entities/mailing-list.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { SubscriptionSource, SubscriptionStatus } from '@/common/enum';

// Unsubscribing keeps the row (as UNSUBSCRIBED) rather than deleting it: it is
// what stops a later admin import from silently re-subscribing the address.
@Entity()
@Unique(['list', 'subscriber'])
// The unique constraint covers list-leading lookups; this covers "every list
// this address is on" (preferences, unsubscribe, the subscriber table).
@Index(['subscriber'])
export class MailingListSubscription extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @ManyToOne(() => MailingList, (l) => l.subscriptions, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    list!: MailingList;

    @ManyToOne(() => Subscriber, (s) => s.subscriptions, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    subscriber!: Subscriber;

    @Column({ type: 'enum', enum: SubscriptionStatus })
    status!: SubscriptionStatus;

    @Column({ type: 'enum', enum: SubscriptionSource })
    source!: SubscriptionSource;

    @Column('timestamptz', { nullable: true })
    confirmedAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    unsubscribedAt!: Date | null;
}
