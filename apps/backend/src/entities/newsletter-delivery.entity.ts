import {
    Column,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { NewsletterDeliveryStatus } from '@/common/enum';

/**
 * One recipient of one newsletter. The whole audience is written here when
 * sending starts, so later list changes never alter who a newsletter goes to,
 * and the row doubles as the send queue.
 */
@Entity()
// Also what makes snapshotting the audience safe to repeat.
@Unique(['newsletter', 'email'])
// The send loop claims PENDING rows per newsletter.
@Index(['newsletter', 'status'])
// The daily limit counts everything SENT in the last 24h, across newsletters.
@Index(['sentAt'])
export class NewsletterDelivery extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @ManyToOne(() => Newsletter, { nullable: false, onDelete: 'CASCADE' })
    newsletter!: Newsletter;

    // Kept as history when the subscriber is erased; email and name are copied
    // onto the row for that reason.
    @ManyToOne(() => Subscriber, { nullable: true, onDelete: 'SET NULL' })
    subscriber!: Subscriber | null;

    @Column('text')
    email!: string;

    @Column('varchar', { length: 255, nullable: true })
    name!: string | null;

    @Column({
        type: 'enum',
        enum: NewsletterDeliveryStatus,
        default: NewsletterDeliveryStatus.PENDING,
    })
    status!: NewsletterDeliveryStatus;

    // The failure message, or why the delivery was skipped.
    @Column('text', { nullable: true })
    error!: string | null;

    @Column('int', { default: 0 })
    attempts!: number;

    // When a send batch took the row; a SENDING row claimed long ago belongs
    // to a worker that died, and is put back to PENDING.
    @Column('timestamptz', { nullable: true })
    claimedAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    sentAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    openedAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    firstClickedAt!: Date | null;

    @Column('int', { default: 0 })
    openCount!: number;

    @Column('int', { default: 0 })
    clickCount!: number;
}
