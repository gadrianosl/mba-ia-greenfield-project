import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { VideosService } from './videos.service';

@Processor('video-processing')
@Injectable()
export class VideosProcessor extends WorkerHost {
  private readonly logger = new Logger(VideosProcessor.name);

  constructor(private readonly videosService: VideosService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Iniciando processamento do Job ID: ${job.id} (${job.name})`);

    if (job.name === 'process-video') {
      const { videoId, publicId, storageKey } = job.data;
      this.logger.log(`Processando vídeo: ${publicId} | Key: ${storageKey}`);

      await this.videosService.processVideo(videoId, storageKey);
    }

    return { completed: true };
  }
}