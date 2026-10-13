import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultipartUpload1791889592791 implements MigrationInterface {
  name = 'AddMultipartUpload1791889592791';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(
      `UPDATE "videos" SET "status" = 'ERROR' WHERE "status" = 'FAILED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "upload_id" character varying(1000)`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "upload_part_size" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "upload_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "upload_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "upload_part_size"`,
    );
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "upload_id"`);
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
