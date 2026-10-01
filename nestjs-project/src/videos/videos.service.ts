import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { Video, VideoStatus } from './entities/video.entity';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
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
}
