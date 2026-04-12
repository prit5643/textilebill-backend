import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum WorkOrderLotTypeEnum {
  IN_HOUSE = 'IN_HOUSE',
  OUTSOURCED = 'OUTSOURCED',
}

export enum WorkOrderLotStatusEnum {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export class WorkOrderSplitLotDto {
  @IsEnum(WorkOrderLotTypeEnum)
  lotType!: WorkOrderLotTypeEnum;

  @IsOptional()
  @IsEnum(WorkOrderLotStatusEnum)
  status?: WorkOrderLotStatusEnum;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Type(() => Number)
  quantity!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  acceptedQuantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Type(() => Number)
  rejectedQuantity?: number;

  @IsOptional()
  @IsUUID()
  vendorAccountId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  agreedRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class SplitWorkOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderSplitLotDto)
  lots!: WorkOrderSplitLotDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  overrideReason?: string;
}
