import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { videoNotFound } from './video.exception';

const execute = promisify(execFile);

@Injectable()
export class VideoProcessingService {
  constructor(
    @InjectRepository(Video) private readonly repository: Repository<Video>,
    private readonly storage: StorageService,
  ) {}

  async process(videoId: string, storageKey: string): Promise<void> {
    const video = await this.repository.findOneBy({ id: videoId });
    if (!video) throw videoNotFound();
    if (video.status === VideoStatus.READY) return;
    if (video.storage_key !== storageKey)
      throw new Error('Job storage key does not match the video');
    video.status = VideoStatus.PROCESSING;
    video.error_reason = null;
    await this.repository.save(video);
    let folder: string | undefined;
    let input: string | undefined;
    try {
      folder = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
      const thumbnail = join(folder, 'thumbnail.jpg');
      input = await this.storage.getProcessingUrl(storageKey);
      const options = {
        timeout:
          Number(process.env.VIDEO_PROCESSING_TIMEOUT_SECONDS || 600) * 1000,
        maxBuffer: 4 * 1024 * 1024,
      };
      const { stdout } = await execute(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_format',
          '-show_streams',
          '-of',
          'json',
          '-protocol_whitelist',
          'http,https,tcp,tls',
          '-format_whitelist',
          'mov,matroska,avi,mpegts,mpeg,ogg,flv',
          '-seekable',
          '1',
          input,
        ],
        options,
      );
      const metadata = JSON.parse(stdout) as {
        format: { duration?: string };
        streams: { codec_type?: string; width?: number; height?: number }[];
      };
      const stream = metadata.streams.find((s) => s.codec_type === 'video');
      const duration = Number(metadata.format.duration);
      if (!stream || !Number.isFinite(duration) || duration <= 0)
        throw new Error('Uploaded media has no valid video stream');
      // A frame near the beginning also supports videos shorter than one second.
      const frameTime = Math.min(1, duration / 2);
      await execute(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'http,https,tcp,tls',
          '-format_whitelist',
          'mov,matroska,avi,mpegts,mpeg,ogg,flv',
          '-seekable',
          '1',
          '-ss',
          String(frameTime),
          '-i',
          input,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:360:force_original_aspect_ratio=decrease',
          '-threads',
          '1',
          '-y',
          thumbnail,
        ],
        options,
      );
      const thumbnailKey = `videos/${video.public_id}/thumbnail.jpg`;
      await this.storage.uploadFile(thumbnailKey, thumbnail, 'image/jpeg');
      video.status = VideoStatus.READY;
      video.duration_seconds = Math.ceil(duration);
      video.width = stream.width ?? null;
      video.height = stream.height ?? null;
      video.metadata = metadata;
      // ffprobe reports its input; do not persist a signed URL in metadata.
      (video.metadata.format as Record<string, unknown>).filename = storageKey;
      video.thumbnail_key = thumbnailKey;
      video.processed_at = new Date();
      await this.repository.save(video);
    } catch (error) {
      video.status = VideoStatus.ERROR;
      const message =
        error instanceof Error ? error.message : 'Video processing failed';
      video.error_reason = (
        input ? message.replaceAll(input, '[object storage URL]') : message
      ).slice(0, 4000);
      await this.repository.save(video);
      throw new Error(video.error_reason);
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
}
