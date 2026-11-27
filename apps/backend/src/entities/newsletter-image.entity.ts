import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '@/entities/base.entity';
import { User } from '@/entities/user.entity';

// An image embedded in a newsletter. Stored in the database rather than on
// disk so it survives redeploys, and served from a public, immutable URL
// because email clients fetch it long after sending.
@Entity()
export class NewsletterImage extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column('varchar', { length: 50 })
    mimeType!: string;

    // Never loaded by default; only the image endpoint asks for it.
    @Column('bytea', { select: false })
    data!: Buffer;

    @Column('int')
    sizeBytes!: number;

    @Column('varchar', { length: 255, nullable: true })
    fileName!: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    uploadedBy!: User | null;
}
