import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { SubscriberStatus } from '@/common/enum';

/**
 * One email address, whatever lists it is on. Deliberately not linked to User:
 * most subscribers never sign in, and a signed-in user's subscriber is found
 * by their email instead.
 */
@Entity()
export class Subscriber extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    // Always stored trimmed and lowercased (see normalizeEmail), so equality
    // here is address equality.
    @Column('text', { unique: true })
    email!: string;

    @Column('varchar', { length: 255, nullable: true })
    name!: string | null;

    // Opaque and random. Carried in every confirm, unsubscribe and preferences
    // link, and the only proof of owning the address those pages accept.
    @Column('varchar', { length: 64, unique: true })
    token!: string;

    // Global: anything but ACTIVE suppresses the address from every send,
    // whatever its list rows say.
    @Column({
        type: 'enum',
        enum: SubscriberStatus,
        default: SubscriberStatus.ACTIVE,
    })
    status!: SubscriberStatus;

    @Column('text', { nullable: true })
    statusReason!: string | null;

    @Column('timestamptz', { nullable: true })
    statusChangedAt!: Date | null;

    // Rate-limits confirmation emails, so the public form cannot be used to
    // flood someone's inbox.
    @Column('timestamptz', { nullable: true })
    lastConfirmationSentAt!: Date | null;

    @OneToMany(() => MailingListSubscription, (s) => s.subscriber)
    subscriptions!: MailingListSubscription[];
}
