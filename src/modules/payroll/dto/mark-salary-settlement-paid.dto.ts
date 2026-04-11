import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class MarkSalarySettlementPaidDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  paidAmount?: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
