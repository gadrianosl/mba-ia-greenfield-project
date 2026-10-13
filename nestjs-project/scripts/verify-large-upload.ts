import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFile, spawn, ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { AppModule as AppModuleType } from '../src/app.module';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  S3Client,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import prepareTestDatabase from '../src/test/global-setup';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import storageConfig from '../src/config/storage.config';

const execute = promisify(execFile);

async function verify(): Promise<void> {
  await prepareTestDatabase();
  process.env.MINIO_PUBLIC_URL = 'http://minio:9000';
  const loadModule = createRequire(__filename);
  const { AppModule } = loadModule('../src/app.module') as {
    AppModule: typeof AppModuleType;
  };
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
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
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const source = app.get(DataSource);
  const queue = app.get<Queue>(getQueueToken(process.env.VIDEO_QUEUE_NAME));
  const config = storageConfig();
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const userId = randomUUID();
  let folder: string | undefined;
  let video: Video | undefined;
  let worker: ChildProcess | undefined;
  const start = Date.now();
  const probes: number[] = [];
  try {
    await queue.pause();
    await source.getRepository(User).save({
      id: userId,
      email: `${userId}@example.com`,
      password: 'large-upload-fixture',
      is_confirmed: true,
    });
    await source
      .getRepository(Channel)
      .save({ user_id: userId, name: 'large upload', nickname: userId });
    const token = app
      .get(JwtService)
      .sign({ sub: userId, email: `${userId}@example.com` });
    async function post(
      path: string,
      body: unknown,
      status = 201,
    ): Promise<any> {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (response.status !== status)
        throw new Error(`API ${path} returned ${response.status}`);
      return response.json();
    }
    const bytes = 10 * 1024 * 1024 * 1024;
    const session = await post('/videos/uploads', {
      title: '10 GiB transfer verification',
      file_size: bytes,
      mime_type: 'video/mp4',
    });
    video = await source
      .getRepository(Video)
      .findOneByOrFail({ public_id: session.public_id });
    const signed: { part_number: number; size: number; upload_url: string }[] =
      [];
    for (let first = 1; first <= session.part_count; first += 100) {
      const part_numbers = Array.from(
        { length: Math.min(100, session.part_count - first + 1) },
        (_, i) => first + i,
      );
      const result = await post(`/videos/${session.public_id}/uploads/parts`, {
        part_numbers,
      });
      signed.push(...result.parts);
    }
    folder = await mkdtemp(join(tmpdir(), 'streamtube-large-upload-'));
    const fixture = join(folder, 'prefix.mp4');
    await execute('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=12',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      'faststart',
      '-y',
      fixture,
    ]);
    const block = Buffer.alloc(session.part_size);
    (await readFile(fixture)).copy(block);
    const parts: { part_number: number; etag: string }[] = [];
    for (const part of signed) {
      const transfer = fetch(part.upload_url, {
        method: 'PUT',
        body: block.subarray(0, part.size),
        headers: { 'Content-Length': String(part.size) },
      });
      if ((part.part_number - 1) % 32 === 0) {
        const before = Date.now();
        const response = await fetch(base + '/', {
          signal: AbortSignal.timeout(5000),
        });
        if (
          response.status !== 200 ||
          (await response.text()) !== 'Hello World!'
        )
          throw new Error('API did not respond during storage transfer');
        probes.push(Date.now() - before);
      }
      const response = await transfer;
      if (!response.ok)
        throw new Error(
          `Storage part ${part.part_number} returned ${response.status}`,
        );
      await response.arrayBuffer();
      const etag = response.headers.get('etag');
      if (!etag) throw new Error('Storage did not return an ETag');
      parts.push({ part_number: part.part_number, etag });
      block.fill(0);
      if (part.part_number % 32 === 0)
        console.log(`Uploaded ${part.part_number}/${session.part_count} parts`);
    }
    await post(`/videos/${session.public_id}/uploads/complete`, { parts }, 202);
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: video.storage_key! }),
    );
    if (head.ContentLength !== bytes)
      throw new Error('Storage byte count did not match 10 GiB');
    if (!(await queue.getJob(video.id)))
      throw new Error('Processing job was not queued');
    worker = spawn(process.execPath, ['dist/worker.js'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Large-upload worker did not become ready')),
        30000,
      );
      worker!.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker!.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error('Large-upload worker exited'));
      });
      worker!.stdout!.on('data', (data) => {
        if (data.toString().includes('Video worker ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await queue.resume();
    const deadline = Date.now() + 60000;
    let ready: Video | undefined;
    while (Date.now() < deadline) {
      const current = await source
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      if (current.status === VideoStatus.READY) {
        ready = current;
        break;
      }
      if (current.status === VideoStatus.ERROR)
        throw new Error(
          `Large-video processing failed: ${current.error_reason}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready?.thumbnail_key || !ready.metadata || !ready.duration_seconds)
      throw new Error(
        'Large video did not reach READY with thumbnail and metadata',
      );
    const thumbnail = await s3.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: ready.thumbnail_key,
      }),
    );
    if (!thumbnail.ContentLength)
      throw new Error('Large-video thumbnail is empty');
    console.log(
      JSON.stringify({
        bytes,
        parts: parts.length,
        seconds: (Date.now() - start) / 1000,
        api_probe_ms: probes,
        queued: true,
        large_file_processing: ready.status,
      }),
    );
  } finally {
    if (worker && worker.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          worker!.kill('SIGKILL');
        }, 5000);
        worker!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        worker!.kill('SIGTERM');
      });
    }
    if (video) {
      const current = await source
        .getRepository(Video)
        .findOneBy({ id: video.id });
      if (current?.thumbnail_key)
        await s3.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: current.thumbnail_key,
          }),
        );
      if (current?.upload_id)
        await s3.send(
          new AbortMultipartUploadCommand({
            Bucket: config.bucket,
            Key: video.storage_key!,
            UploadId: current.upload_id,
          }),
        );
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: video.storage_key!,
        }),
      );
      const job = await queue.getJob(video.id);
      if (job) await job.remove();
    }
    await queue.resume();
    await source.getRepository(Channel).delete({ user_id: userId });
    await source.getRepository(User).delete(userId);
    s3.destroy();
    if (folder) await rm(folder, { recursive: true, force: true });
    await app.close();
  }
}
void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
