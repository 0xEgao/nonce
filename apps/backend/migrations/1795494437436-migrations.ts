import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1795494437436 implements MigrationInterface {
    name = 'Migrations1795494437436';

    /**
     * Newsletter / mailing-list tables: lists, subscribers (one row per email
     * address) and their per-list subscriptions, newsletters with their list
     * targets, the per-recipient delivery rows that double as the send queue,
     * and uploaded newsletter images. All new; no existing table is touched.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "mailing_list" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "slug" character varying(140) NOT NULL, "description" text, "isPublic" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_871b71e15ae01efbe5546706d06" UNIQUE ("slug"), CONSTRAINT "PK_47204fc6c993c9f2b5933391127" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."subscriber_status_enum" AS ENUM('ACTIVE', 'UNSUBSCRIBED', 'BOUNCED')`,
        );
        await queryRunner.query(
            `CREATE TABLE "subscriber" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text NOT NULL, "name" character varying(255), "token" character varying(64) NOT NULL, "status" "public"."subscriber_status_enum" NOT NULL DEFAULT 'ACTIVE', "statusReason" text, "statusChangedAt" TIMESTAMP WITH TIME ZONE, "lastConfirmationSentAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_073600148a22d05dcf81d119a6a" UNIQUE ("email"), CONSTRAINT "UQ_73e8593250d9712f5db05baab34" UNIQUE ("token"), CONSTRAINT "PK_1c52b7ddbaf79cd2650045b79c7" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."mailing_list_subscription_status_enum" AS ENUM('PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED')`,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."mailing_list_subscription_source_enum" AS ENUM('PUBLIC_FORM', 'PROFILE', 'ADMIN', 'PORTAL_USERS')`,
        );
        await queryRunner.query(
            `CREATE TABLE "mailing_list_subscription" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" "public"."mailing_list_subscription_status_enum" NOT NULL, "source" "public"."mailing_list_subscription_source_enum" NOT NULL, "confirmedAt" TIMESTAMP WITH TIME ZONE, "unsubscribedAt" TIMESTAMP WITH TIME ZONE, "listId" uuid NOT NULL, "subscriberId" uuid NOT NULL, CONSTRAINT "UQ_f0cf43c26503ef5d818d0c8160e" UNIQUE ("listId", "subscriberId"), CONSTRAINT "PK_4660cea69072758dafa2e239200" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_902beeb02816fb3df74a6244fa" ON "mailing_list_subscription"  ("subscriberId") `,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."newsletter_contentformat_enum" AS ENUM('RICH_TEXT', 'HTML')`,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."newsletter_status_enum" AS ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED')`,
        );
        await queryRunner.query(
            `CREATE TABLE "newsletter" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subject" character varying(255) NOT NULL, "preheader" character varying(255), "contentFormat" "public"."newsletter_contentformat_enum" NOT NULL DEFAULT 'RICH_TEXT', "content" text NOT NULL DEFAULT '', "replyTo" character varying(320), "status" "public"."newsletter_status_enum" NOT NULL DEFAULT 'DRAFT', "adHocEmails" jsonb NOT NULL DEFAULT '[]', "trackingEnabled" boolean NOT NULL DEFAULT false, "trackedLinks" jsonb NOT NULL DEFAULT '[]', "totalRecipients" integer NOT NULL DEFAULT '0', "scheduledAt" TIMESTAMP WITH TIME ZONE, "sendStartedAt" TIMESTAMP WITH TIME ZONE, "sentAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "pausedUntil" TIMESTAMP WITH TIME ZONE, "lastProgressAt" TIMESTAMP WITH TIME ZONE, "pauseReason" text, "createdById" uuid, CONSTRAINT "PK_036bb790d1d19efeacfd2f3740c" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TYPE "public"."newsletter_delivery_status_enum" AS ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')`,
        );
        await queryRunner.query(
            `CREATE TABLE "newsletter_delivery" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text NOT NULL, "name" character varying(255), "status" "public"."newsletter_delivery_status_enum" NOT NULL DEFAULT 'PENDING', "error" text, "attempts" integer NOT NULL DEFAULT '0', "claimedAt" TIMESTAMP WITH TIME ZONE, "sentAt" TIMESTAMP WITH TIME ZONE, "openedAt" TIMESTAMP WITH TIME ZONE, "firstClickedAt" TIMESTAMP WITH TIME ZONE, "openCount" integer NOT NULL DEFAULT '0', "clickCount" integer NOT NULL DEFAULT '0', "newsletterId" uuid NOT NULL, "subscriberId" uuid, CONSTRAINT "UQ_0c9d3bec190e3d18b2887e251fb" UNIQUE ("newsletterId", "email"), CONSTRAINT "PK_ed49081e0ed0befe56663dd6628" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_5ecb88aa10a84159eaf834d685" ON "newsletter_delivery"  ("sentAt") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c44aee80db6256a0b37ad23924" ON "newsletter_delivery"  ("newsletterId", "status") `,
        );
        await queryRunner.query(
            `CREATE TABLE "newsletter_image" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "mimeType" character varying(50) NOT NULL, "data" bytea NOT NULL, "sizeBytes" integer NOT NULL, "fileName" character varying(255), "uploadedById" uuid, CONSTRAINT "PK_8385e5fca5f57a63a5b7e7f6f39" PRIMARY KEY ("id"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "newsletter_mailing_list" ("newsletterId" uuid NOT NULL, "mailingListId" uuid NOT NULL, CONSTRAINT "PK_d904a2403ff7ca37d0e1fc0dd59" PRIMARY KEY ("newsletterId", "mailingListId"))`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_364d08f6a117cc54a09738a563" ON "newsletter_mailing_list"  ("newsletterId") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_4637b064ca76b642a4d05041db" ON "newsletter_mailing_list"  ("mailingListId") `,
        );
        await queryRunner.query(
            `ALTER TABLE "mailing_list_subscription" ADD CONSTRAINT "FK_e4ca5cf4f6129364dbfb2dc550f" FOREIGN KEY ("listId") REFERENCES "mailing_list"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "mailing_list_subscription" ADD CONSTRAINT "FK_902beeb02816fb3df74a6244fa5" FOREIGN KEY ("subscriberId") REFERENCES "subscriber"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter" ADD CONSTRAINT "FK_3382f74337b093fff042d2c00f7" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_delivery" ADD CONSTRAINT "FK_87a68e947ecb93f3866980a3a5b" FOREIGN KEY ("newsletterId") REFERENCES "newsletter"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_delivery" ADD CONSTRAINT "FK_1a54b87de22e763b007720625c3" FOREIGN KEY ("subscriberId") REFERENCES "subscriber"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_image" ADD CONSTRAINT "FK_c05e70b57ec5da6732fc6bf5042" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_mailing_list" ADD CONSTRAINT "FK_364d08f6a117cc54a09738a5635" FOREIGN KEY ("newsletterId") REFERENCES "newsletter"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_mailing_list" ADD CONSTRAINT "FK_4637b064ca76b642a4d05041db9" FOREIGN KEY ("mailingListId") REFERENCES "mailing_list"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "newsletter_mailing_list" DROP CONSTRAINT "FK_4637b064ca76b642a4d05041db9"`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_mailing_list" DROP CONSTRAINT "FK_364d08f6a117cc54a09738a5635"`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_image" DROP CONSTRAINT "FK_c05e70b57ec5da6732fc6bf5042"`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_delivery" DROP CONSTRAINT "FK_1a54b87de22e763b007720625c3"`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter_delivery" DROP CONSTRAINT "FK_87a68e947ecb93f3866980a3a5b"`,
        );
        await queryRunner.query(
            `ALTER TABLE "newsletter" DROP CONSTRAINT "FK_3382f74337b093fff042d2c00f7"`,
        );
        await queryRunner.query(
            `ALTER TABLE "mailing_list_subscription" DROP CONSTRAINT "FK_902beeb02816fb3df74a6244fa5"`,
        );
        await queryRunner.query(
            `ALTER TABLE "mailing_list_subscription" DROP CONSTRAINT "FK_e4ca5cf4f6129364dbfb2dc550f"`,
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_4637b064ca76b642a4d05041db"`,
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_364d08f6a117cc54a09738a563"`,
        );
        await queryRunner.query(`DROP TABLE "newsletter_mailing_list"`);
        await queryRunner.query(`DROP TABLE "newsletter_image"`);
        await queryRunner.query(
            `DROP INDEX "public"."IDX_c44aee80db6256a0b37ad23924"`,
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_5ecb88aa10a84159eaf834d685"`,
        );
        await queryRunner.query(`DROP TABLE "newsletter_delivery"`);
        await queryRunner.query(
            `DROP TYPE "public"."newsletter_delivery_status_enum"`,
        );
        await queryRunner.query(`DROP TABLE "newsletter"`);
        await queryRunner.query(`DROP TYPE "public"."newsletter_status_enum"`);
        await queryRunner.query(
            `DROP TYPE "public"."newsletter_contentformat_enum"`,
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_902beeb02816fb3df74a6244fa"`,
        );
        await queryRunner.query(`DROP TABLE "mailing_list_subscription"`);
        await queryRunner.query(
            `DROP TYPE "public"."mailing_list_subscription_source_enum"`,
        );
        await queryRunner.query(
            `DROP TYPE "public"."mailing_list_subscription_status_enum"`,
        );
        await queryRunner.query(`DROP TABLE "subscriber"`);
        await queryRunner.query(`DROP TYPE "public"."subscriber_status_enum"`);
        await queryRunner.query(`DROP TABLE "mailing_list"`);
    }
}
