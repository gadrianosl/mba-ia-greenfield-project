import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { StorageModule } from '../storage/storage.module';
import { VideosProcessor } from './videos.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    StorageModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'video-processing',
    }),
  ],
  controllers: [VideosController],
  providers: [VideosService, VideosProcessor],
  exports: [TypeOrmModule, VideosService],
})
export class VideosModule {}