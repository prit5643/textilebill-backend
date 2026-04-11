import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseWorkOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  overrideReason?: string;
}
