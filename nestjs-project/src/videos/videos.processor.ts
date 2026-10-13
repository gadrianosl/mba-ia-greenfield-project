import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { VideoProcessingService } from './video-processing.service';
import { VIDEO_QUEUE } from './queue/video-queue.module';

export interface VideoJob {
  videoId: string;
  storageKey: string;
}

@Processor(VIDEO_QUEUE, {
  concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY || 2),
})
export class VideosProcessor extends WorkerHost {
  constructor(private readonly processing: VideoProcessingService) {
    super();
  }

  async process(job: Job<VideoJob>): Promise<void> {
    if (job.name !== 'process-video')
      throw new Error(`Unknown video job: ${job.name}`);
    await this.processing.process(job.data.videoId, job.data.storageKey);
  }
}
