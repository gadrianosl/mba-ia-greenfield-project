import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideosTable1791487267142 implements MigrationInterface {
  name = 'CreateVideosTable1791487267142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."videos_status_enum" RENAME TO "videos_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('DRAFT', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'ERROR', 'FAILED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" TYPE "public"."videos_status_enum" USING "status"::"text"::"public"."videos_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`,
    );
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum_old"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_33b997d60e0bac645832489a2a" ON "videos" ("channel_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_39a1f0fe7991162aace659078e" ON "videos" ("public_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39a1f0fe7991162aace659078e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33b997d60e0bac645832489a2a"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum_old" AS ENUM('DRAFT', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" TYPE "public"."videos_status_enum_old" USING "status"::"text"::"public"."videos_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'DRAFT'`,
    );
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."videos_status_enum_old" RENAME TO "videos_status_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_status" ON "videos" ("channel_id", "status") `,
    );
  }
}
