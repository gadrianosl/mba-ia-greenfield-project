import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { VideosProcessor } from './videos.processor';
import { VIDEO_QUEUE } from './queue/video-queue.module';

const repository = { findOne: jest.fn(), save: jest.fn() };
const dataSource = {
  options: { type: 'postgres' },
  entityMetadatas: [],
  getRepository: jest.fn().mockReturnValue(repository),
};

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: dataSource }],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('VideosModule', () => {
  it('should resolve API providers without registering the video worker', async () => {
    const module = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        VideosModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue({})
      .overrideProvider(getQueueToken(VIDEO_QUEUE))
      .useValue({ add: jest.fn() })
      .compile();

    try {
      expect(module.get(VideosService)).toBeInstanceOf(VideosService);
      expect(module.get(VideosController)).toBeInstanceOf(VideosController);
      expect(() => module.get(VideosProcessor)).toThrow();
    } finally {
      await module.close();
    }
  });
});
