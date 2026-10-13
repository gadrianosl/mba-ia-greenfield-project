import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { InitializeVideoUploadDto } from './initialize-video-upload.dto';

export class StartVideoUploadDto extends InitializeVideoUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
