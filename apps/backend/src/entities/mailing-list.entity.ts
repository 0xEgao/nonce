import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';

@Entity()
export class MailingList extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column('varchar', { length: 120 })
    name!: string;

    // Public sign-up forms name lists by slug, so it is stable once shared.
    @Column('varchar', { length: 140, unique: true })
    slug!: string;

    @Column('text', { nullable: true })
    description!: string | null;

    // Offered on the public subscribe form and in everyone's preferences.
    // Private lists are only joined by an admin adding the address.
    @Column('boolean', { default: false })
    isPublic!: boolean;

    @Column('timestamptz', { nullable: true })
    archivedAt!: Date | null;

    @OneToMany(() => MailingListSubscription, (s) => s.list)
    subscriptions!: MailingListSubscription[];
}
