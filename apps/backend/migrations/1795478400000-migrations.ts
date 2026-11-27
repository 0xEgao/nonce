import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1795478400000 implements MigrationInterface {
    name = 'Migrations1795478400000';

    /**
     * Adds fellowship.discordRoleAssigned, which records that the app has
     * granted the fellow's Discord role and not yet removed it.
     *
     * COMPLETED fellowships start out flagged, so the first daily run removes
     * the fellow role from fellows whose fellowship had already ended. ACTIVE
     * ones start unflagged and are granted the role by that same run.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "fellowship" ADD "discordRoleAssigned" boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `UPDATE "fellowship" SET "discordRoleAssigned" = true WHERE "status" = 'COMPLETED'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "fellowship" DROP COLUMN "discordRoleAssigned"`,
        );
    }
}
