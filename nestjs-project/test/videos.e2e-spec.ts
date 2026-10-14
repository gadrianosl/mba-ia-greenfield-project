import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_QUEUE } from '../src/videos/queue/video-queue.module';
import { StorageService } from '../src/storage/storage.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

const execute = promisify(execFile);
const bucket = 'streamtube-test';
const mailpit = process.env.MAILPIT_API_URL ?? 'http://mailpit:8025';

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  timeout = 30000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for video processing');
}

describe('Videos with real storage, queue and separate worker (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let repository: Repository<Video>;
  let queue: Queue;
  let throttler: ThrottlerStorageService;
  let s3: S3Client;
  let worker: ChildProcess;
  let folder: string;
  let fixture: Buffer;
  let owner: string;
  let stranger: string;

  async function cleanStorage(): Promise<void> {
    const uploads = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: bucket }),
    );
    for (const upload of uploads.Uploads ?? []) {
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
    let continuation: string | undefined;
    do {
      const listed = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuation,
        }),
      );
      if (listed.Contents?.length) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) },
          }),
        );
      }
      continuation = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuation);
  }

  async function login(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const messagesResponse = await fetch(`${mailpit}/api/v1/messages`);
    expect(messagesResponse.ok).toBe(true);
    const messages = (await messagesResponse.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const message = messages.messages.find((item) =>
      item.To.some((recipient) => recipient.Address === email),
    );
    expect(message).toBeDefined();
    const detailResponse = await fetch(
      `${mailpit}/api/v1/message/${message!.ID}`,
    );
    expect(detailResponse.ok).toBe(true);
    const detail = (await detailResponse.json()) as { HTML: string };
    const link = detail.HTML.match(/href="([^"]+)"/);
    expect(link).toBeTruthy();
    const token = new URL(link![1].replaceAll('&amp;', '&')).searchParams.get(
      'token',
    );
    expect(token).toBeTruthy();
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token })
      .expect(204);
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    expect(response.body.access_token).toEqual(expect.any(String));
    return response.body.access_token;
  }

  beforeAll(async () => {
    if (
      process.env.DB_NAME !== 'streamtube_test' ||
      VIDEO_QUEUE !== 'video-processing-test' ||
      process.env.MINIO_BUCKET !== bucket
    ) {
      throw new Error(
        'Video E2E requires isolated test database, queue and bucket',
      );
    }
    process.env.MINIO_PUBLIC_URL = 'http://minio:9000';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    dataSource = module.get(DataSource);
    repository = dataSource.getRepository(Video);
    queue = module.get(getQueueToken(VIDEO_QUEUE));
    throttler = module.get(ThrottlerStorage);
    s3 = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT ?? 'http://minio:9000',
      region: process.env.MINIO_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'streamtube',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'streamtube',
      },
    });
    await module.get(StorageService).ensureBucket();
    await queue.obliterate({ force: true });
    folder = await mkdtemp(join(tmpdir(), 'video-e2e-'));
    const path = join(folder, 'fixture.mp4');
    await execute('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=10',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-y',
      path,
    ]);
    fixture = await readFile(path);
    worker = spawn(process.execPath, ['dist/worker.js'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`Worker startup timed out: ${output}`)),
        60000,
      );
      const onOutput = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-4000);
        if (output.includes('Video worker ready')) {
          clearTimeout(timer);
          resolve();
        }
      };
      worker.stdout!.on('data', onOutput);
      worker.stderr!.on('data', onOutput);
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Worker exited ${code}: ${output}`));
      });
    });
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    await cleanStorage();
    throttler.onApplicationShutdown();
    throttler.storage.clear();
    const response = await fetch(`${mailpit}/api/v1/messages`, {
      method: 'DELETE',
    });
    expect(response.ok).toBe(true);
    owner = await login('owner-video@example.com');
    stranger = await login('stranger-video@example.com');
  });

  afterAll(async () => {
    if (worker && worker.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => worker.kill('SIGKILL'), 5000);
        worker.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        worker.kill('SIGTERM');
      });
    }
    if (queue) await queue.obliterate({ force: true });
    if (dataSource?.isInitialized) await cleanAllTables(dataSource);
    if (s3) {
      await cleanStorage();
      s3.destroy();
    }
    if (throttler) {
      throttler.onApplicationShutdown();
      throttler.storage.clear();
    }
    if (app) await app.close();
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  async function start(size = fixture.length) {
    const response = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${owner}`)
      .send({ title: 'Video E2E', file_size: size, mime_type: 'video/mp4' })
      .expect(201);
    expect(response.body.public_id).toEqual(expect.any(String));
    return response.body as {
      public_id: string;
      storage_key: string;
      part_count: number;
      part_size: number;
    };
  }

  async function upload(publicId: string, body = fixture): Promise<string> {
    const signed = await request(app.getHttpServer())
      .post(`/videos/${publicId}/uploads/parts`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ part_numbers: [1] })
      .expect(201);
    const response = await fetch(signed.body.parts[0].upload_url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Length': String(body.length) },
    });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    return etag!;
  }

  async function complete(publicId: string, etag: string, status = 202) {
    return request(app.getHttpServer())
      .post(`/videos/${publicId}/uploads/complete`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ parts: [{ part_number: 1, etag }] })
      .expect(status);
  }

  it('uploads directly, processes in worker and streams/downloads the original with JPEG thumbnail', async () => {
    const session = await start();
    const pending = await repository.findOneByOrFail({
      public_id: session.public_id,
    });
    expect(pending.status).toBe(VideoStatus.UPLOADING);
    await request(app.getHttpServer())
      .get(`/videos/${session.public_id}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/stream`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/download`)
      .expect(404);
    const unpublished = await request(app.getHttpServer())
      .get('/videos')
      .expect(200);
    expect(unpublished.body.data).toHaveLength(0);
    await complete(session.public_id, await upload(session.public_id));
    const video = await waitFor(async () => {
      const row = await repository.findOneByOrFail({
        public_id: session.public_id,
      });
      return row.status === VideoStatus.READY ? row : undefined;
    });
    expect(video.duration_seconds).toBe(2);
    expect(video.width).toBe(160);
    expect(video.height).toBe(90);
    expect(video.metadata).toBeTruthy();
    expect(video.processed_at).toBeInstanceOf(Date);
    const stream = await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/stream`)
      .set('Range', 'bytes=0-99')
      .expect(206);
    expect(stream.headers['content-range']).toBe(
      `bytes 0-99/${fixture.length}`,
    );
    expect(stream.headers['content-length']).toBe('100');
    expect(stream.body).toEqual(fixture.subarray(0, 100));
    const suffix = await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/stream`)
      .set('Range', 'bytes=-32')
      .expect(206);
    expect(suffix.headers['content-range']).toBe(
      `bytes ${fixture.length - 32}-${fixture.length - 1}/${fixture.length}`,
    );
    expect(suffix.body).toEqual(fixture.subarray(-32));
    const invalidRange = await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/stream`)
      .set('Range', `bytes=${fixture.length}-`)
      .expect(416);
    expect(invalidRange.headers['content-range']).toBe(
      `bytes */${fixture.length}`,
    );
    const download = await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/download`)
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.body).toEqual(fixture);
    const thumbnail = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: video.thumbnail_key! }),
    );
    expect(thumbnail.ContentType).toBe('image/jpeg');
    expect((await thumbnail.Body!.transformToByteArray()).slice(0, 2)).toEqual(
      new Uint8Array([255, 216]),
    );
    await request(app.getHttpServer())
      .get(`/videos/${session.public_id}`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(404);
    const listing = await request(app.getHttpServer())
      .get('/videos')
      .expect(200);
    expect(listing.body.data[0].public_id).toBe(session.public_id);
  });

  it('enforces authentication, input validation and the 10 GiB boundary without uploading a huge fixture', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({})
      .expect(401);
    for (const body of [
      { title: '', file_size: 10, mime_type: 'video/mp4' },
      { title: 'large', file_size: 10 * 1024 ** 3 + 1, mime_type: 'video/mp4' },
      { title: 'wrong type', file_size: 10, mime_type: 'text/plain' },
      { title: 'missing MIME', file_size: 10 },
      { title: 'missing size', mime_type: 'video/mp4' },
    ]) {
      await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${owner}`)
        .send(body)
        .expect(400);
    }
    expect(await repository.count()).toBe(0);
    const boundary = await start(10 * 1024 ** 3);
    expect(boundary.part_count).toBe(
      Math.ceil((10 * 1024 ** 3) / boundary.part_size),
    );
    await request(app.getHttpServer())
      .delete(`/videos/${boundary.public_id}/upload`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(204);
  });

  it('rejects mismatching ETags and sizes before enqueueing and aborts back to draft', async () => {
    const session = await start();
    const etag = await upload(session.public_id);
    await complete(session.public_id, 'wrong-etag', 400);
    const video = await repository.findOneByOrFail({
      public_id: session.public_id,
    });
    expect(await queue.getJob(video.id)).toBeUndefined();
    // Altering the declared size in DB tests the completion check independently of signed Content-Length.
    await repository.update(video.id, {
      file_size: String(fixture.length + 1),
    });
    await complete(session.public_id, etag, 400);
    expect(await queue.getJob(video.id)).toBeUndefined();
    await request(app.getHttpServer())
      .delete(`/videos/${session.public_id}/upload`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/videos/${session.public_id}/upload`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(204);
    const aborted = await repository.findOneByOrFail({ id: video.id });
    expect(aborted.status).toBe(VideoStatus.DRAFT);
    expect(aborted.upload_id).toBeNull();
    expect(aborted.storage_key).toBeNull();
    expect(
      (await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket })))
        .Uploads ?? [],
    ).toHaveLength(0);
  });

  it('persists ERROR and exhausts three real queue attempts for invalid media', async () => {
    const invalid = Buffer.from('this is not an MP4 video');
    const session = await start(invalid.length);
    await complete(session.public_id, await upload(session.public_id, invalid));
    const video = await repository.findOneByOrFail({
      public_id: session.public_id,
    });
    const failed = await waitFor(async () => {
      const job = await queue.getJob(video.id);
      return job && (await job.getState()) === 'failed' ? job : undefined;
    });
    expect(failed.attemptsMade).toBe(3);
    const persisted = await repository.findOneByOrFail({ id: video.id });
    expect(persisted.status).toBe(VideoStatus.ERROR);
    expect(persisted.error_reason).toBeTruthy();
    await request(app.getHttpServer())
      .post(`/videos/${session.public_id}/process`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/videos/${session.public_id}/process`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(202);
    const retried = await waitFor(async () => {
      const job = await queue.getJob(video.id);
      return job && (await job.getState()) === 'failed' ? job : undefined;
    });
    expect(retried.attemptsMade).toBe(3);
    expect((await repository.findOneByOrFail({ id: video.id })).status).toBe(
      VideoStatus.ERROR,
    );
    await request(app.getHttpServer())
      .get(`/videos/${session.public_id}/stream`)
      .expect(404);
  });
});
