import { Module } from '@nestjs/common';
import { RuntimeModule } from './config/runtime.module';
import { VideosModule } from './videos/videos.module';
import { VideosProcessor } from './videos/videos.processor';
import { VideoProcessingService } from './videos/video-processing.service';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [RuntimeModule, VideosModule, StorageModule],
  providers: [VideosProcessor, VideoProcessingService],
})
export class WorkerModule {}
