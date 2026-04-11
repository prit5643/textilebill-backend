import { IsDateString, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalaryAdvanceDto {
  @IsUUID()
  personId!: string;

  @IsNumber()
  @Type(() => Number)
  amount!: number;

  @IsDateString()
  advanceDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
