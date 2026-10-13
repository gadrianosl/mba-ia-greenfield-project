import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1790812800000 implements MigrationInterface {
  name = 'CreateVideos1790812800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('DRAFT', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "description" text, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'DRAFT', "storage_key" character varying(500), "thumbnail_key" character varying(500), "file_size" bigint, "mime_type" character varying(120), "duration_seconds" integer, "width" integer, "height" integer, "metadata" jsonb, "error_reason" text, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_videos_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_status" ON "videos" ("channel_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_status"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
