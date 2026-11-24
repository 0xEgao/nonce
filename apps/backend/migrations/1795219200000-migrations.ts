import { MigrationInterface, QueryRunner } from 'typeorm';
import { composeLocation, locationProblem } from '@nonce/shared';
import { parseLegacyLocation } from '../src/users/legacy-location';

export class Migrations1795219200000 implements MigrationInterface {
    name = 'Migrations1795219200000';

    /**
     * Adds the structured location (country, Indian state, city) behind the
     * location pickers (#45), and fills it from the old free-text `location`
     * where that text is unambiguous ("Pune, India" -> IN / Maharashtra /
     * Pune). Everyone else re-picks the next time they save their profile,
     * join a cohort or submit a fellowship application.
     *
     * A fully read location also has `location` rewritten to the composed
     * form ("Pune, Maharashtra, India"), so search by state or country finds
     * it. A partly read one keeps its old text until the user re-picks.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "user" ADD "country" character varying(2)`,
        );
        await queryRunner.query(
            `ALTER TABLE "user" ADD "state" character varying(100)`,
        );
        await queryRunner.query(
            `ALTER TABLE "user" ADD "city" character varying(255)`,
        );

        const rows: { id: string; location: string }[] =
            await queryRunner.query(
                `SELECT "id", "location" FROM "user" WHERE "location" IS NOT NULL`,
            );
        let complete = 0;
        let partial = 0;
        for (const row of rows) {
            const parts = parseLegacyLocation(row.location);
            if (!parts) continue;
            const isComplete = locationProblem(parts) === null;
            await queryRunner.query(
                `UPDATE "user" SET "country" = $2, "state" = $3, "city" = $4,
                    "location" = COALESCE($5, "location")
                 WHERE "id" = $1`,
                [
                    row.id,
                    parts.country,
                    parts.state,
                    parts.city,
                    isComplete ? composeLocation(parts) : null,
                ],
            );
            if (isComplete) complete++;
            else partial++;
        }
        console.log(
            `Location backfill: ${complete} complete, ${partial} partial, ` +
                `${rows.length - complete - partial} left as free text ` +
                `(of ${rows.length} users with a location)`,
        );
    }

    /** Drops the parts; rewritten `location` strings are not restored. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "city"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "state"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "country"`);
    }
}
