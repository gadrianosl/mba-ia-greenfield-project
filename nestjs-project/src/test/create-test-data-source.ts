import { DataSource, EntitySchema, MigrationInterface } from 'typeorm';

interface TestDataSourceOptions {
  synchronize?: boolean;
  migrations?: (new () => MigrationInterface)[];
  database?: string;
}

export function createTestDataSource(
  entities: (Function | string | EntitySchema<any>)[],
  options: TestDataSourceOptions = {},
): DataSource {
  const { synchronize = false, migrations } = options;
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'db',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'streamtube',
    password: process.env.DB_PASSWORD ?? 'streamtube',
    database:
      options.database ??
      process.env.DB_DATABASE ??
      process.env.DB_NAME ??
      'streamtube_test',
    entities,
    synchronize,
    ...(migrations !== undefined && { migrations, migrationsRun: false }),
  });
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  if (
    await dataSource
      .query("SELECT to_regclass('public.videos') AS name")
      .then((rows) => rows[0].name)
  ) {
    await dataSource.query('DELETE FROM "videos"');
  }
  await dataSource.query('DELETE FROM "refresh_tokens"');
  await dataSource.query('DELETE FROM "verification_tokens"');
  await dataSource.query('DELETE FROM "channels"');
  await dataSource.query('DELETE FROM "users"');
}
