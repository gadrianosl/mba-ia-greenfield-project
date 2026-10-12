import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthTokens1777579850478 implements MigrationInterface {
  name = 'CreateAuthTokens1777579850478';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "verification_tokens_type_enum" AS ENUM('email_confirmation', 'password_reset');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "verification_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token_hash" character varying NOT NULL, "type" "verification_tokens_type_enum" NOT NULL, "user_id" uuid NOT NULL, "expires_at" TIMESTAMP NOT NULL, "used_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f2d4d7a2aa57ef199e61567db22" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_19d8484a0754cd015ca11302a5" ON "verification_tokens" ("token_hash")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token_hash" character varying NOT NULL, "family" uuid NOT NULL, "user_id" uuid NOT NULL, "expires_at" TIMESTAMP NOT NULL, "revoked_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens" ("token_hash")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_46561d7f0169611662bbc8f542" ON "refresh_tokens" ("family", "revoked_at")`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "verification_tokens" ADD CONSTRAINT "FK_31d2079dc4079b80517d31cf4f2" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" DROP CONSTRAINT IF EXISTS "FK_31d2079dc4079b80517d31cf4f2"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_46561d7f0169611662bbc8f542"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_a7838d2ba25be1342091b6695f"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_19d8484a0754cd015ca11302a5"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "verification_tokens"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"`,
    );
  }
}