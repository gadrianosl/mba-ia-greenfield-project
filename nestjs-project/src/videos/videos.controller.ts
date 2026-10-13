import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { InitializeVideoUploadDto } from './dto/initialize-video-upload.dto';
import { StartVideoUploadDto } from './dto/start-video-upload.dto';
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { VideosService } from './videos.service';
import { normalizeRange } from './streaming-range';

class VideoPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
}

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {}

  @Public()
  @Get()
  findAll(@Query() query: VideoPageDto) {
    return this.videosService.findAllPublic(query.page, query.limit);
  }

  @Post('drafts')
  createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDraftDto,
  ) {
    return this.videosService.createDraft(user.sub, dto);
  }

  @Post('uploads')
  startUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartVideoUploadDto,
  ) {
    return this.videosService.startUpload(user.sub, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.videosService.listMine(user.sub);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.findOneDetails(publicId, user.sub);
  }

  @Post(':publicId/upload')
  initializeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: InitializeVideoUploadDto,
  ) {
    return this.videosService.initializeUpload(user.sub, publicId, dto);
  }

  @Post(':publicId/uploads/parts')
  signParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: SignUploadPartsDto,
  ) {
    return this.videosService.signParts(user.sub, publicId, dto.part_numbers);
  }

  @Post([':publicId/uploads/complete', ':publicId/upload/complete'])
  @HttpCode(HttpStatus.ACCEPTED)
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteVideoUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, publicId, dto);
  }

  @Delete(':publicId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.cancelUpload(user.sub, publicId);
  }

  @Post(':publicId/process')
  @HttpCode(HttpStatus.ACCEPTED)
  reprocess(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.videosService.reprocess(user.sub, publicId);
  }

  @Public()
  @Get(':publicId/stream')
  async streamVideo(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findReady(publicId);
    let selectedRange: string | undefined;
    if (range) {
      const head = await this.storageService.headObject(video.storage_key!);
      const size = head.ContentLength ?? Number(video.file_size);
      try {
        selectedRange = normalizeRange(range, size);
      } catch (error) {
        res.setHeader('Content-Range', `bytes */${size}`);
        throw error;
      }
    }
    const object = await this.storageService.getObjectStream(
      video.storage_key!,
      selectedRange,
    );
    res.status(selectedRange ? 206 : 200);
    res.setHeader('Content-Type', object.contentType || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (object.contentLength !== undefined)
      res.setHeader('Content-Length', object.contentLength);
    if (object.contentRange)
      res.setHeader('Content-Range', object.contentRange);
    await pipeline(object.stream, res);
  }

  @Public()
  @Get(':publicId/download')
  async downloadVideo(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findReady(publicId);
    const object = await this.storageService.getObjectStream(
      video.storage_key!,
    );
    const filename = `${video.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'video'}.mp4`;
    res.status(200);
    res.setHeader('Content-Type', object.contentType || 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (object.contentLength !== undefined)
      res.setHeader('Content-Length', object.contentLength);
    await pipeline(object.stream, res);
  }
}
