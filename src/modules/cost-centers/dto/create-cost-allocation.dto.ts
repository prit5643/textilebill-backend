import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCostAllocationDto {
  @IsOptional()
  @IsUUID()
  expenseEntryId?: string;

  @IsOptional()
  @IsUUID()
  expenseId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  allocatedAmount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
