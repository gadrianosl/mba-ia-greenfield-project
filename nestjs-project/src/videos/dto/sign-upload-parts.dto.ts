import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';

export class SignUploadPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  part_numbers: number[];
}
