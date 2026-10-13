import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { VideosProcessor } from './videos/videos.processor';
import { Logger } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  await app.get(VideosProcessor).worker.waitUntilReady();
  Logger.log('Video worker ready');
}

void bootstrap().catch((error: unknown) => {
  console.error('Video worker failed to start', error);
  process.exitCode = 1;
});
