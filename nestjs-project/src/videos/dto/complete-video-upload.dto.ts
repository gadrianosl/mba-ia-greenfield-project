import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UploadedPartDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  etag: string;
}

export class CompleteVideoUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts: UploadedPartDto[];
}
