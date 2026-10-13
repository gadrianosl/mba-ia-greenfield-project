import { Module } from '@nestjs/common';
import { RuntimeModule } from './config/runtime.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [RuntimeModule, AuthModule, VideosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
