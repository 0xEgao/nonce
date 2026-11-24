import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    Index,
    OneToMany,
} from 'typeorm';
import { GroupDiscussionScore } from '@/entities/group-discussion-score.entity';
import { ExerciseScore } from '@/entities/exercise-score.entity';
import { Attendance } from '@/entities/attendance.entity';
import { BaseEntity } from '@/entities/base.entity';
import { UserRole } from '@/common/enum';
import { CohortWaitlist } from '@/entities/cohort-waitlist.entity';
import { Certificate } from '@/entities/certificate.entity';
import { FellowshipApplication } from '@/entities/fellowship-application.entity';
import { Fellowship } from '@/entities/fellowship.entity';
import { CohortMembership } from '@/entities/cohort-membership.entity';

@Entity()
// Admin list endpoints search these columns with ILIKE '%term%' -- the first four
// through the shared free-text search, `location` through the user pool's city
// filter. A leading wildcard rules out B-tree, so in the database these are
// pg_trgm GIN indexes -- see the follow-up migrations that swap them. Since 1.x
// TypeORM's schema diff compares the access method, so `type: 'gin'` is what
// stops it turning them back into B-trees. It cannot express the operator class
// (gin_trgm_ops), though, so only the migrations can create these: a CREATE from
// TypeORM itself (synchronize on an unmigrated database) would fail.
@Index(['name'], { type: 'gin' })
@Index(['email'], { type: 'gin' })
@Index(['discordUserName'], { type: 'gin' })
@Index(['discordGlobalName'], { type: 'gin' })
@Index(['location'], { type: 'gin' })
export class User extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column('text', { unique: true, nullable: true })
    email!: string | null;

    @Column('text', { unique: true })
    discordUserId!: string;

    @Column('text')
    discordUserName!: string;

    @Column('text', { nullable: true })
    discordGlobalName!: string | null;

    @Column('boolean', { default: false })
    isGuildMember!: boolean;

    @Column('varchar', { nullable: true })
    name!: string | null;

    @Column({ type: 'enum', enum: UserRole })
    role!: UserRole;

    @Column('varchar', { nullable: true })
    description!: string | null;

    @Column('text', { nullable: true })
    background!: string | null;

    @Column('varchar', { length: 2048, nullable: true })
    githubProfileUrl!: string | null;

    @Column('varchar', { length: 2048, nullable: true })
    portfolioUrl!: string | null;

    @Column('varchar', { length: 2048, nullable: true })
    linkedinProfileUrl!: string | null;

    @Column({ type: 'jsonb', default: [] })
    skills!: string[];

    @Column({ type: 'date', nullable: true })
    firstHeardAboutBitcoinOn!: string | null;

    @Column({ type: 'jsonb', default: [] })
    bitcoinBooksRead!: string[];

    @Column('text', { nullable: true })
    whyBitcoin!: string | null;

    @Column('int', { nullable: true })
    weeklyCohortCommitmentHours!: number | null;

    // Display string composed from country/state/city ("Pune, Maharashtra,
    // India"). Users who haven't re-picked since the structured fields arrived
    // may still hold an old free-text value here with no parts.
    @Column('varchar', { length: 255, nullable: true })
    location!: string | null;

    /** ISO 3166-1 alpha-2 code. */
    @Column('varchar', { length: 2, nullable: true })
    country!: string | null;

    /** Indian state name (INDIAN_STATES in @nonce/shared); null elsewhere. */
    @Column('varchar', { length: 100, nullable: true })
    state!: string | null;

    @Column('varchar', { length: 255, nullable: true })
    city!: string | null;

    @Column('varchar', { length: 255, nullable: true })
    referral!: string | null;

    @OneToMany(() => CohortMembership, (m) => m.user)
    cohortMemberships!: CohortMembership[];

    @OneToMany(() => GroupDiscussionScore, (gds) => gds.user)
    groupDiscussionScores!: GroupDiscussionScore[];

    @OneToMany(() => Attendance, (a) => a.user)
    attendances!: Attendance[];

    @OneToMany(() => ExerciseScore, (es) => es.user)
    exerciseScores!: ExerciseScore[];

    @OneToMany(() => CohortWaitlist, (cwl) => cwl.user)
    cohortsWaitlist!: CohortWaitlist[];

    @OneToMany(
        () => GroupDiscussionScore,
        (gds) => gds.assignedTeachingAssistant,
    )
    assignedGroupDiscussionScores!: GroupDiscussionScore[];

    @OneToMany(() => Certificate, (c) => c.user)
    certificates!: Certificate[];

    @OneToMany(() => FellowshipApplication, (fa) => fa.applicant)
    fellowshipApplications!: FellowshipApplication[];

    @OneToMany(() => Fellowship, (f) => f.user)
    fellowships!: Fellowship[];

    get displayName(): string {
        return this.name || this.discordGlobalName || this.discordUserName;
    }
}
