import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { InitializeVideoUploadDto } from './dto/initialize-video-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {}

  @Public()
  @Get()
  findAll(@Query('page') page = '1', @Query('limit') limit = '10') {
    return this.videosService.findAllPublic(+page, +limit);
  }

  @Post('drafts')
  createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDraftDto,
  ): Promise<Video> {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload): Promise<Video[]> {
    return this.videosService.listMine(user.sub);
  }

  @Get(':publicId')
  findOne(@Param('publicId') publicId: string) {
    return this.videosService.findOneDetails(publicId);
  }

  @Post(':publicId/upload')
  initializeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: InitializeVideoUploadDto,
  ): Promise<{
    public_id: string;
    storage_key: string;
    upload_url: string;
    expires_in: number;
  }> {
    return this.videosService.initializeUpload(user.sub, publicId, dto);
  }

  @Post(':publicId/upload/complete')
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<Video> {
    return this.videosService.completeUpload(user.sub, publicId);
  }

  @Public()
  @Get(':publicId/stream')
  async streamVideo(
    @Param('publicId') publicId: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    const video = await this.videosService.findOneDetails(publicId);

    if (video.status !== VideoStatus.READY || !video.storage_key) {
      throw new BadRequestException(
        'O vídeo ainda não está pronto para reprodução.',
      );
    }

    const { stream, contentLength, contentRange, acceptRanges, contentType } =
      await this.storageService.getObjectStream(video.storage_key, range);

    const statusCode = range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

    res.writeHead(statusCode, {
      'Content-Type': contentType || 'video/mp4',
      ...(contentLength !== undefined && { 'Content-Length': contentLength }),
      'Accept-Ranges': acceptRanges || 'bytes',
      ...(contentRange && { 'Content-Range': contentRange }),
    });

    stream.pipe(res);
  }

  @Public()
  @Get(':publicId/download')
  async downloadVideo(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ) {
    const video = await this.videosService.findOneDetails(publicId);

    if (video.status !== VideoStatus.READY || !video.storage_key) {
      throw new BadRequestException(
        'O vídeo ainda não está disponível para download.',
      );
    }

    const { stream, contentLength, contentType } =
      await this.storageService.getObjectStream(video.storage_key);

    const safeTitle = (video.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeTitle}.mp4`;

    res.writeHead(HttpStatus.OK, {
      'Content-Type': contentType || 'video/mp4',
      ...(contentLength !== undefined && { 'Content-Length': contentLength }),
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    stream.pipe(res);
  }
}
