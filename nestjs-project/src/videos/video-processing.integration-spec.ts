import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoProcessingService } from './video-processing.service';

const execute = promisify(execFile);

describe('VideoProcessingService (real PostgreSQL, MinIO and FFmpeg)', () => {
  let module: TestingModule;
  let source: DataSource;
  let storage: StorageService;
  let processing: VideoProcessingService;
  let folder: string;
  let fixture: string;
  let client: S3Client;
  const ids: string[] = [];
  const keys: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(
          createTestDataSource([User, Channel, Video]).options,
        ),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [VideoProcessingService],
    }).compile();
    source = module.get(DataSource);
    storage = module.get(StorageService);
    processing = module.get(VideoProcessingService);
    const config = storageConfig();
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    folder = await mkdtemp(join(tmpdir(), 'streamtube-processing-test-'));
    fixture = join(folder, 'short.mp4');
    await execute(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x120:rate=12',
        '-t',
        '0.5',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-y',
        fixture,
      ],
      { timeout: 15000 },
    );
  }, 30000);

  afterAll(async () => {
    try {
      for (const key of keys)
        await client.send(
          new DeleteObjectCommand({ Bucket: storageConfig().bucket, Key: key }),
        );
      for (const id of ids) {
        await source.getRepository(Channel).delete({ user_id: id });
        await source.getRepository(User).delete(id);
      }
    } finally {
      client?.destroy();
      if (folder) await rm(folder, { recursive: true, force: true });
      await module?.close();
    }
  });

  async function upload(path: string): Promise<Video> {
    const id = randomUUID();
    ids.push(id);
    const user = await source.getRepository(User).save({
      id,
      email: `${id}@example.com`,
      password: 'integration-fixture',
      is_confirmed: true,
    });
    const channel = await source
      .getRepository(Channel)
      .save({ user_id: user.id, nickname: id, name: 'integration video' });
    const publicId = randomUUID();
    const key = storage.buildVideoKey(publicId);
    keys.push(key, `videos/${publicId}/thumbnail.jpg`);
    await storage.uploadFile(key, path, 'video/mp4');
    return source.getRepository(Video).save({
      channel_id: channel.id,
      public_id: publicId,
      title: 'integration',
      status: VideoStatus.UPLOADED,
      storage_key: key,
    });
  }

  it('extracts metadata and creates a JPEG for a video shorter than one second; repeated processing is idempotent', async () => {
    const video = await upload(fixture);
    await processing.process(video.id, video.storage_key!);
    const processed = await source
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(processed.status).toBe(VideoStatus.READY);
    expect(processed.width).toBe(160);
    expect(processed.height).toBe(120);
    expect(processed.duration_seconds).toBe(1);
    expect(processed.metadata).toHaveProperty('streams');
    expect(processed.metadata).toHaveProperty(
      'format.filename',
      video.storage_key,
    );
    expect(JSON.stringify(processed.metadata)).not.toMatch(
      /X-Amz-|https?:\/\//i,
    );
    const thumbnail = await client.send(
      new GetObjectCommand({
        Bucket: storageConfig().bucket,
        Key: processed.thumbnail_key!,
      }),
    );
    const bytes = await thumbnail.Body!.transformToByteArray();
    expect(Array.from(bytes.slice(0, 3))).toEqual([255, 216, 255]);
    await processing.process(video.id, video.storage_key!);
    const repeated = await source
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(repeated.processed_at).toEqual(processed.processed_at);
  });

  it('persists ERROR and a reason for invalid media and propagates the failure to the queue', async () => {
    const invalid = join(folder, 'invalid.mp4');
    await writeFile(invalid, 'not a video');
    const video = await upload(invalid);
    await expect(
      processing.process(video.id, video.storage_key!),
    ).rejects.toThrow();
    const failed = await source
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(failed.status).toBe(VideoStatus.ERROR);
    expect(failed.error_reason).toBeTruthy();
    expect(failed.error_reason).not.toMatch(/X-Amz-|https?:\/\//i);
    expect(failed.thumbnail_key).toBeNull();
  });

  it('enforces unique public IDs and cascades videos when their channel is removed', async () => {
    const video = await upload(fixture);
    await expect(
      source.getRepository(Video).save({
        channel_id: video.channel_id,
        public_id: video.public_id,
        title: 'duplicate',
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await source.getRepository(Channel).delete(video.channel_id);
    expect(
      await source.getRepository(Video).findOneBy({ id: video.id }),
    ).toBeNull();
  });
});
