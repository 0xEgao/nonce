import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1795737600000 implements MigrationInterface {
    name = 'Migrations1795737600000';

    /**
     * Records admin changes to a fellowship's end date: originalEndDate keeps
     * the contracted date the first time it changes, and endDateChangedAt /
     * endDateChangedById record the latest change. All null on existing rows,
     * none of which has had its end date changed.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "fellowship" ADD "originalEndDate" TIMESTAMP WITH TIME ZONE`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" ADD "endDateChangedAt" TIMESTAMP WITH TIME ZONE`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" ADD "endDateChangedById" uuid`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" ADD CONSTRAINT "FK_bf7809bed63b127b1c1aa3d41b6" FOREIGN KEY ("endDateChangedById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "fellowship" DROP CONSTRAINT "FK_bf7809bed63b127b1c1aa3d41b6"`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" DROP COLUMN "endDateChangedById"`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" DROP COLUMN "endDateChangedAt"`,
        );
        await queryRunner.query(
            `ALTER TABLE "fellowship" DROP COLUMN "originalEndDate"`,
        );
    }
}
