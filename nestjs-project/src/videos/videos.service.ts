import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import { InitializeVideoUploadDto } from './dto/initialize-video-upload.dto';
import { Channel } from '../channels/entities/channel.entity';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { Video, VideoStatus } from './entities/video.entity';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
  ) {}

  async createDraft(userId: string, dto: CreateVideoDraftDto): Promise<Video> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const video = this.videoRepository.create({
      channel_id: channel.id,
      public_id: randomUUID(),
      title: dto.title,
      description: dto.description ?? null,
      file_size: dto.file_size?.toString() ?? null,
      mime_type: dto.mime_type ?? null,
      status: VideoStatus.DRAFT,
    });

    return this.videoRepository.save(video);
  }

  returnMine(userId: string): Promise<Video[]> {
    return this.listMine(userId);
  }

  async listMine(userId: string): Promise<Video[]> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return this.videoRepository.find({
      where: { channel_id: channel.id },
      order: { created_at: 'DESC' },
    });
  }

  async initializeUpload(
    userId: string,
    publicId: string,
    dto: InitializeVideoUploadDto,
  ): Promise<{
    public_id: string;
    storage_key: string;
    upload_url: string;
    expires_in: number;
  }> {
    const video = await this.findOwnedVideo(userId, publicId);

    if (video.status !== VideoStatus.DRAFT) {
      throw new ConflictException(
        'Video upload can only be initialized from DRAFT status',
      );
    }

    const maxVideoSize = 10 * 1024 * 1024 * 1024;

    if (dto.file_size > maxVideoSize) {
      throw new BadRequestException('Video file is too large');
    }

    const storageKey = this.storageService.buildVideoKey(video.public_id);
    const uploadUrl = await this.storageService.createPresignedPutUrl(
      storageKey,
      dto.mime_type,
    );

    video.file_size = dto.file_size.toString();
    video.mime_type = dto.mime_type;
    video.storage_key = storageKey;
    video.status = VideoStatus.UPLOADING;

    await this.videoRepository.save(video);

    return {
      public_id: video.public_id,
      storage_key: storageKey,
      upload_url: uploadUrl,
      expires_in: 3600,
    };
  }

  async completeUpload(userId: string, publicId: string): Promise<Video> {
    const video = await this.findOwnedVideo(userId, publicId);

    if (video.status !== VideoStatus.UPLOADING) {
      throw new ConflictException(
        'Video upload can only be completed from UPLOADING status',
      );
    }

    if (!video.storage_key) {
      throw new BadRequestException('Video storage key is missing');
    }

    try {
      const object = await this.storageService.headObject(video.storage_key);

      if (
        video.file_size &&
        object.ContentLength !== undefined &&
        object.ContentLength !== Number(video.file_size)
      ) {
        throw new BadRequestException('Uploaded file size does not match');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new NotFoundException('Uploaded video object was not found');
    }

    video.status = VideoStatus.UPLOADED;
    const savedVideo = await this.videoRepository.save(video);

    await this.videoQueue.add('process-video', {
      videoId: savedVideo.id,
      publicId: savedVideo.public_id,
      storageKey: savedVideo.storage_key,
    });

    return savedVideo;
  }

  async processVideo(videoId: string, storageKey: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });

    if (!video) {
      throw new NotFoundException(`Video with ID ${videoId} not found`);
    }

    this.logger.log(`A alterar estado do vídeo ${video.public_id} para PROCESSING...`);
    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    try {
      // Caso tenhas lógica de FFmpeg ou descarregamento do StorageService, executa aqui.
      // Atualização dos metadados e alteração do estado para READY:
      video.status = VideoStatus.READY;
      video.processed_at = new Date();
      
      // Se a tua entidade tiver estas colunas, atribui os valores extraídos:
      // video.duration_seconds = 120;
      // video.width = 1920;
      // video.height = 1080;

      const updatedVideo = await this.videoRepository.save(video);
      this.logger.log(`Vídeo ${video.public_id} processado com sucesso (READY).`);
      return updatedVideo;
    } catch (error) {
      this.logger.error(`Erro ao processar o vídeo ${video.public_id}:`, error);
      video.status = VideoStatus.FAILED;
      await this.videoRepository.save(video);
      throw error;
    }
  }

  private async findOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const video = await this.videoRepository.findOne({
      where: {
        public_id: publicId,
        channel_id: channel.id,
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    return video;
  }
}