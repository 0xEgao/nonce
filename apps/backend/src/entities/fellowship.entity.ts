import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import {
    FellowshipType,
    FellowshipStatus,
    FellowshipKind,
} from '@/common/enum';
import { User } from '@/entities/user.entity';
import { FellowshipApplication } from '@/entities/fellowship-application.entity';
import { FellowshipReport } from '@/entities/fellowship-report.entity';

@Entity()
export class Fellowship extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'enum', enum: FellowshipType })
    type!: FellowshipType;

    // Fellowship tier. Defaults to FELLOWSHIP so existing rows backfill; set to
    // STARTER_GRANT by an admin at accept time.
    @Column({
        type: 'enum',
        enum: FellowshipKind,
        default: FellowshipKind.FELLOWSHIP,
    })
    kind!: FellowshipKind;

    @Column({
        type: 'enum',
        enum: FellowshipStatus,
        default: FellowshipStatus.PENDING,
    })
    status!: FellowshipStatus;

    @Column('timestamptz', { nullable: true })
    startDate!: Date | null;

    @Column('timestamptz', { nullable: true })
    endDate!: Date | null;

    // The contracted end date, saved the first time an admin changes endDate.
    // Null while the contract still ends on the date it started with.
    @Column('timestamptz', { nullable: true })
    originalEndDate!: Date | null;

    // When an admin last changed endDate; endDateChangedBy is who.
    @Column('timestamptz', { nullable: true })
    endDateChangedAt!: Date | null;

    @Column('decimal', { nullable: true, precision: 10, scale: 2 })
    amountUsd!: string | null;

    @Column('text', { nullable: true })
    driveFolderUrl!: string | null;

    // True while the fellow holds the Discord fellow role because of this
    // fellowship: set when the app grants it, cleared when the app removes it.
    @Column('boolean', { default: false })
    discordRoleAssigned!: boolean;

    @ManyToOne(() => User)
    user!: User;

    @ManyToOne(() => User, { nullable: true })
    endDateChangedBy!: User | null;

    @OneToOne(() => FellowshipApplication, (fa) => fa.fellowship)
    @JoinColumn()
    application!: FellowshipApplication;

    @OneToMany(() => FellowshipReport, (fr) => fr.fellowship)
    reports!: FellowshipReport[];
}
