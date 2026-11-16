import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1794787200000 implements MigrationInterface {
    name = 'Migrations1794787200000';

    /**
     * Seeds the recurring COMPLETE_ENDED_FELLOWSHIPS task, which moves ACTIVE
     * fellowships past their endDate to COMPLETED. Each run queues the next one
     * (daily, 04:00 UTC), so only the first has to be inserted here.
     *
     * The first run is the next 04:00 UTC, which also clears any fellowships that
     * ended before this shipped. The NOT EXISTS guard keeps a re-run from
     * starting a second chain.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        const now = new Date();
        const executeOnTime = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                4,
            ),
        );
        if (executeOnTime <= now) {
            executeOnTime.setUTCDate(executeOnTime.getUTCDate() + 1);
        }

        await queryRunner.query(
            `
            INSERT INTO "api_task" ("type", "data", "executeOnTime", "status", "retryCount")
            SELECT 'COMPLETE_ENDED_FELLOWSHIPS', '{}'::jsonb, $1::timestamptz, 'UNPROCESSED', 0
            WHERE NOT EXISTS (
                SELECT 1 FROM "api_task"
                WHERE "type" = 'COMPLETE_ENDED_FELLOWSHIPS'
                  AND "status" IN ('UNPROCESSED', 'PROCESSING', 'FAILED')
            )
            `,
            [executeOnTime.toISOString()],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "api_task" WHERE "type" = 'COMPLETE_ENDED_FELLOWSHIPS'`,
        );
    }
}
