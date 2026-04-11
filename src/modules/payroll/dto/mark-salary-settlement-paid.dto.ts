import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class MarkSalarySettlementPaidDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  paidAmount?: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
