import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum WorkOrderLotTypeDto {
  IN_HOUSE = 'IN_HOUSE',
  OUTSOURCED = 'OUTSOURCED',
}

export class SplitWorkOrderLotDto {
  @IsEnum(WorkOrderLotTypeDto)
  lotType: WorkOrderLotTypeDto;

  @IsNumber()
  @Min(0.001)
  plannedQty: number;

  @IsOptional()
  @IsUUID()
  vendorAccountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  agreedRate?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SplitWorkOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitWorkOrderLotDto)
  lots: SplitWorkOrderLotDto[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  overrideReason?: string;
}
