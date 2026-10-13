import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Video } from '../videos/entities/video.entity';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1790812800000 } from '../database/migrations/1790812800000-CreateVideos';
import { CreateVideosTable1791487267142 } from '../database/migrations/1791487267142-CreateVideosTable';
import { AddMultipartUpload1791889592791 } from '../database/migrations/1791889592791-AddMultipartUpload';

export const migrations = [
  CreateUsersAndChannels1775687773260,
  CreateAuthTokens1777579850478,
  CreateVideos1790812800000,
  CreateVideosTable1791487267142,
  AddMultipartUpload1791889592791,
];

export default async function prepareTestDatabase(): Promise<void> {
  const database = process.env.DB_TEST_NAME || 'streamtube_test';
  if (
    !/^[a-z][a-z0-9_]{0,50}_test$/.test(database) ||
    database === process.env.DB_NAME
  ) {
    throw new Error(
      'DB_TEST_NAME must end in _test and differ from the development database',
    );
  }
  const connection = {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || 'streamtube',
    password: process.env.DB_PASSWORD || 'streamtube',
  };
  const admin = new DataSource({ ...connection, database: 'postgres' });
  await admin.initialize();
  try {
    const exists = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (!exists.length) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.destroy();
  }
  process.env.DB_NAME = database;
  process.env.DB_DATABASE = database;
  process.env.VIDEO_QUEUE_NAME = 'video-processing-test';
  process.env.MINIO_BUCKET = 'streamtube-test';
  const dataSource = new DataSource({
    ...connection,
    database,
    entities: [User, Channel, RefreshToken, VerificationToken, Video],
    migrations,
    synchronize: false,
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
