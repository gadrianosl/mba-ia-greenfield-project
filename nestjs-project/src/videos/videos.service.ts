import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { InitializeVideoUploadDto } from './dto/initialize-video-upload.dto';
import { Channel } from '../channels/entities/channel.entity';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { StartVideoUploadDto } from './dto/start-video-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VIDEO_QUEUE } from './queue/video-queue.module';
import {
  invalidUpload,
  videoConflict,
  VideoException,
  videoNotFound,
} from './video.exception';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_QUEUE) private readonly videoQueue: Queue,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async createDraft(userId: string, dto: CreateVideoDraftDto): Promise<Video> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) throw videoNotFound();
    return this.videoRepository.save(
      this.videoRepository.create({
        channel_id: channel.id,
        public_id: randomUUID(),
        title: dto.title,
        description: dto.description ?? null,
        status: VideoStatus.DRAFT,
      }),
    );
  }

  async startUpload(userId: string, dto: StartVideoUploadDto) {
    this.validateSize(dto.file_size);
    const draft = await this.createDraft(userId, dto);
    return this.initializeUpload(userId, draft.public_id, dto);
  }

  async listMine(userId: string): Promise<Video[]> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) throw videoNotFound();
    return this.videoRepository.find({
      where: { channel_id: channel.id },
      order: { created_at: 'DESC' },
    });
  }

  private validateSize(size: number): void {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > this.config.maxVideoSizeBytes
    ) {
      throw invalidUpload('Video size must be between 1 byte and 10 GiB');
    }
  }

  private async withOwner<T>(
    userId: string,
    publicId: string,
    action: (video: Video, repo: Repository<Video>) => Promise<T>,
  ): Promise<T> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) throw videoNotFound();
    return this.videoRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Video);
      const video = await repo.findOne({
        where: { public_id: publicId, channel_id: channel.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) throw videoNotFound();
      return action(video, repo);
    });
  }

  private requireSession(video: Video): void {
    if (
      video.status !== VideoStatus.UPLOADING ||
      !video.upload_id ||
      !video.storage_key ||
      !video.upload_part_size
    )
      throw videoConflict();
    if (
      !video.upload_expires_at ||
      video.upload_expires_at.getTime() <= Date.now()
    ) {
      throw new VideoException(
        'UPLOAD_EXPIRED',
        410,
        'Upload session expired; cancel and restart the upload',
      );
    }
  }

  private session(video: Video) {
    return {
      public_id: video.public_id,
      storage_key: video.storage_key,
      part_size: video.upload_part_size!,
      part_count: Math.ceil(Number(video.file_size) / video.upload_part_size!),
      expires_in: this.config.presignedExpiresInSeconds,
    };
  }

  async initializeUpload(
    userId: string,
    publicId: string,
    dto: InitializeVideoUploadDto,
  ) {
    this.validateSize(dto.file_size);
    return this.withOwner(userId, publicId, async (video, repo) => {
      if (video.status === VideoStatus.UPLOADING) {
        this.requireSession(video);
        if (
          Number(video.file_size) !== dto.file_size ||
          video.mime_type !== dto.mime_type
        )
          throw videoConflict();
        return this.session(video);
      }
      if (video.status !== VideoStatus.DRAFT) throw videoConflict();
      const key = this.storageService.buildVideoKey(video.public_id);
      const uploadId = await this.storageService.initiateMultipart(
        key,
        dto.mime_type,
      );
      video.file_size = String(dto.file_size);
      video.mime_type = dto.mime_type;
      video.storage_key = key;
      video.upload_id = uploadId;
      video.upload_part_size = this.config.uploadPartSize;
      video.upload_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
      video.status = VideoStatus.UPLOADING;
      try {
        await repo.save(video);
      } catch (error) {
        await this.storageService.abortMultipart(key, uploadId);
        throw error;
      }
      return this.session(video);
    });
  }

  async signParts(userId: string, publicId: string, partNumbers: number[]) {
    return this.withOwner(userId, publicId, async (video) => {
      this.requireSession(video);
      const session = this.session(video);
      if (partNumbers.some((n) => n > session.part_count))
        throw invalidUpload('Part number is outside this upload');
      const parts = await Promise.all(
        partNumbers.map(async (part_number) => {
          const size = Math.min(
            session.part_size,
            Number(video.file_size) - (part_number - 1) * session.part_size,
          );
          return {
            part_number,
            size,
            upload_url: await this.storageService.signPart(
              video.storage_key!,
              video.upload_id!,
              part_number,
              size,
            ),
          };
        }),
      );
      return { ...session, parts };
    });
  }

  async completeUpload(
    userId: string,
    publicId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<Video> {
    const video = await this.withOwner(
      userId,
      publicId,
      async (video, repo) => {
        if (video.status === VideoStatus.UPLOADED) return video;
        this.requireSession(video);
        const parts = [...dto.parts].sort(
          (a, b) => a.part_number - b.part_number,
        );
        const session = this.session(video);
        if (
          parts.length !== session.part_count ||
          parts.some((p, i) => p.part_number !== i + 1)
        )
          throw invalidUpload('All unique upload parts are required');
        const actual = await this.storageService.listParts(
          video.storage_key!,
          video.upload_id!,
        );
        if (
          actual.length !== parts.length ||
          actual.some((part, i) => {
            const expectedSize = Math.min(
              session.part_size,
              Number(video.file_size) - i * session.part_size,
            );
            return (
              part.part_number !== parts[i].part_number ||
              part.etag !== parts[i].etag ||
              part.size !== expectedSize
            );
          })
        )
          throw invalidUpload('Uploaded part sizes or ETags do not match');
        await this.storageService.completeMultipart(
          video.storage_key!,
          video.upload_id!,
          parts,
        );
        const head = await this.storageService.headObject(video.storage_key!);
        if (head.ContentLength !== Number(video.file_size))
          throw invalidUpload('Uploaded file size does not match');
        video.status = VideoStatus.UPLOADED;
        video.upload_id = null;
        video.upload_expires_at = null;
        return repo.save(video);
      },
    );
    await this.enqueue(video);
    return video;
  }

  private async enqueue(video: Video): Promise<void> {
    await this.videoQueue.add(
      'process-video',
      { videoId: video.id, storageKey: video.storage_key },
      {
        jobId: video.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    );
  }

  async cancelUpload(userId: string, publicId: string): Promise<void> {
    await this.withOwner(userId, publicId, async (video, repo) => {
      if (
        video.status !== VideoStatus.UPLOADING ||
        !video.storage_key ||
        !video.upload_id
      )
        throw videoConflict();
      await this.storageService.abortMultipart(
        video.storage_key,
        video.upload_id,
      );
      video.status = VideoStatus.DRAFT;
      video.upload_id = null;
      video.upload_part_size = null;
      video.upload_expires_at = null;
      video.storage_key = null;
      video.file_size = null;
      video.mime_type = null;
      await repo.save(video);
    });
  }

  async reprocess(userId: string, publicId: string): Promise<Video> {
    const video = await this.withOwner(
      userId,
      publicId,
      async (video, repo) => {
        if (video.status !== VideoStatus.ERROR || !video.storage_key)
          throw videoConflict();
        const job = await this.videoQueue.getJob(video.id);
        if (job) {
          const state = await job.getState();
          if (state === 'active' || state === 'waiting' || state === 'delayed')
            throw videoConflict();
          await job.remove();
        }
        video.status = VideoStatus.UPLOADED;
        video.error_reason = null;
        return repo.save(video);
      },
    );
    await this.enqueue(video);
    return video;
  }

  async findOneDetails(publicId: string, userId: string): Promise<Video> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    const video =
      channel &&
      (await this.videoRepository.findOneBy({
        public_id: publicId,
        channel_id: channel.id,
      }));
    if (!video) throw videoNotFound();
    return video;
  }

  async findReady(publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ public_id: publicId });
    if (!video || video.status !== VideoStatus.READY) throw videoNotFound();
    return video;
  }

  async findAllPublic(page = 1, limit = 10) {
    const [videos, total] = await this.videoRepository.findAndCount({
      where: { status: VideoStatus.READY },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const data = await Promise.all(
      videos.map(async (video) => ({
        public_id: video.public_id,
        title: video.title,
        description: video.description,
        duration_seconds: video.duration_seconds,
        width: video.width,
        height: video.height,
        stream_url: `/videos/${video.public_id}/stream`,
        thumbnail_url: video.thumbnail_key
          ? await this.storageService.getPresignedGetUrl(video.thumbnail_key)
          : null,
      })),
    );
    return { data, meta: { total, page, last_page: Math.ceil(total / limit) } };
  }
}
