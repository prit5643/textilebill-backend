import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SalarySettlementAdjustmentDto {
  @IsUUID()
  personId!: string;

  @IsNumber()
  @Type(() => Number)
  adjustments!: number;

  @IsOptional()
  adjustmentNote?: string;
}

export class RunSalarySettlementDto {
  @IsNumber()
  @Type(() => Number)
  month!: number;

  @IsNumber()
  @Type(() => Number)
  year!: number;

  @IsOptional()
  @IsBoolean()
  previewOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  finalize?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalarySettlementAdjustmentDto)
  adjustments?: SalarySettlementAdjustmentDto[];
}
