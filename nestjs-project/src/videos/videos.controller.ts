import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CreateVideoDraftDto } from './dto/create-video-draft.dto';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

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
}
