import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseWorkOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  overrideReason?: string;
}
