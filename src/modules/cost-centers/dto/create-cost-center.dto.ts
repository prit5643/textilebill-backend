import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum CostCenterTypeEnum {
  MONTHLY_POOL = 'MONTHLY_POOL',
  PRODUCTION_LOT = 'PRODUCTION_LOT',
  ORDER = 'ORDER',
  DEPARTMENT = 'DEPARTMENT',
  MACHINE = 'MACHINE',
  LOT = 'LOT',
  MONTH = 'MONTH',
}

export class CreateCostCenterDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsEnum(CostCenterTypeEnum)
  scopeType?: CostCenterTypeEnum;

  @IsOptional()
  @IsEnum(CostCenterTypeEnum)
  costCenterType?: CostCenterTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  scopeReference?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
