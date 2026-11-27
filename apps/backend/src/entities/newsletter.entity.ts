import {
    Column,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { MailingList } from '@/entities/mailing-list.entity';
import { User } from '@/entities/user.entity';
import { NewsletterContentFormat, NewsletterStatus } from '@/common/enum';

@Entity()
export class Newsletter extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column('varchar', { length: 255 })
    subject!: string;

    // Inbox preview text, rendered as a hidden span at the top of the body.
    @Column('varchar', { length: 255, nullable: true })
    preheader!: string | null;

    @Column({
        type: 'enum',
        enum: NewsletterContentFormat,
        default: NewsletterContentFormat.RICH_TEXT,
    })
    contentFormat!: NewsletterContentFormat;

    @Column('text', { default: '' })
    content!: string;

    // Null falls back to the configured newsletter Reply-To.
    @Column('varchar', { length: 320, nullable: true })
    replyTo!: string | null;

    @Column({
        type: 'enum',
        enum: NewsletterStatus,
        default: NewsletterStatus.DRAFT,
    })
    status!: NewsletterStatus;

    @ManyToMany(() => MailingList)
    @JoinTable({ name: 'newsletter_mailing_list' })
    lists!: MailingList[];

    // One-off recipients outside any list, as typed by the admin.
    @Column('jsonb', { default: [] })
    adHocEmails!: string[];

    @Column('boolean', { default: false })
    trackingEnabled!: boolean;

    // Frozen when sending starts: click URLs carry an index into this, so it
    // must not change under emails already sent.
    @Column('jsonb', { default: [] })
    trackedLinks!: string[];

    @Column('int', { default: 0 })
    totalRecipients!: number;

    @Column('timestamptz', { nullable: true })
    scheduledAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    sendStartedAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    sentAt!: Date | null;

    @Column('timestamptz', { nullable: true })
    cancelledAt!: Date | null;

    // Set while the daily limit or a provider throttle holds sending back.
    @Column('timestamptz', { nullable: true })
    pausedUntil!: Date | null;

    // Bumped by every send batch; the stall-recovery cron re-queues a SENDING
    // newsletter whose progress has gone quiet.
    @Column('timestamptz', { nullable: true })
    lastProgressAt!: Date | null;

    @Column('text', { nullable: true })
    pauseReason!: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    createdBy!: User | null;
}
