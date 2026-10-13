import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';

export class InitializeVideoUploadDto {
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024 * 1024)
  file_size: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^video\/[a-z0-9.+-]+$/i, {
    message: 'mime_type must be a valid video MIME type',
  })
  mime_type: string;
}
