import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVideoDraftDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024 * 1024)
  file_size?: number;

  @IsOptional()
  @IsString()
  mime_type?: string;
}
