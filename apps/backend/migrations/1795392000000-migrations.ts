import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1795392000000 implements MigrationInterface {
    name = 'Migrations1795392000000';

    /**
     * Renames three partial indexes and two CHECK constraints to the names
     * TypeORM 1.x gives them. Both versions name these objects by hashing
     * their definition, but 0.3 hashed it URL-encoded and 1.x hashes it raw,
     * so a name changes wherever the definition holds a space or a quote:
     * every index with a `where` and every `@Check`. Under the old names 1.x
     * treats them as foreign and generates a migration that drops and
     * recreates each one.
     *
     * A rename only touches the catalog: nothing is rebuilt or revalidated.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        // api_task: the UNPROCESSED and FAILED backlog indexes.
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_b979052946495f18ea3ec33e3e" RENAME TO "IDX_0a35f2d7f4c36b28daba65269c"`,
        );
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_c8d4518ca0e1ee0b6ffd3d856d" RENAME TO "IDX_2c4bfdf7efa325ae8d47b12dfc"`,
        );
        // ci_run: the in-flight index RECONCILE_CI_RUN sweeps.
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_0d24c1bf53dfc3894f1db4ebf6" RENAME TO "IDX_18dbc7216eeb5da47b6b9e9f47"`,
        );
        await queryRunner.query(
            `ALTER TABLE "certificate" RENAME CONSTRAINT "CHK_4410d90fe7c4f0fab19dac8c02" TO "CHK_a9e39e4215b535e2c85df82a9a"`,
        );
        await queryRunner.query(
            `ALTER TABLE "cohort_week" RENAME CONSTRAINT "CHK_04a461693e8644a0b84bd70b41" TO "CHK_db7261e0b0eee51c4c39f02461"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "cohort_week" RENAME CONSTRAINT "CHK_db7261e0b0eee51c4c39f02461" TO "CHK_04a461693e8644a0b84bd70b41"`,
        );
        await queryRunner.query(
            `ALTER TABLE "certificate" RENAME CONSTRAINT "CHK_a9e39e4215b535e2c85df82a9a" TO "CHK_4410d90fe7c4f0fab19dac8c02"`,
        );
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_18dbc7216eeb5da47b6b9e9f47" RENAME TO "IDX_0d24c1bf53dfc3894f1db4ebf6"`,
        );
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_2c4bfdf7efa325ae8d47b12dfc" RENAME TO "IDX_c8d4518ca0e1ee0b6ffd3d856d"`,
        );
        await queryRunner.query(
            `ALTER INDEX "public"."IDX_0a35f2d7f4c36b28daba65269c" RENAME TO "IDX_b979052946495f18ea3ec33e3e"`,
        );
    }
}
