import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

export const VIDEO_QUEUE = process.env.VIDEO_QUEUE_NAME || 'video-processing';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: Number(process.env.REDIS_PORT || 6379),
      },
    }),
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
  ],
  exports: [BullModule],
})
export class VideoQueueModule {}
