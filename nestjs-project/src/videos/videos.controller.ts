import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator'; // Importe o decorator Public
import type { JwtPayload } from '../auth/auth.types';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { InitializeVideoUploadDto } from './dto/initialize-video-upload.dto';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Public() // Adicione este decorator
  @Get()
  findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
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
}