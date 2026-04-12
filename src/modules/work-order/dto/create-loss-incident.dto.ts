import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum WorkOrderLossReasonCodeEnum {
  QUALITY = 'QUALITY',
  DAMAGE = 'DAMAGE',
  SHORTAGE = 'SHORTAGE',
  DELIVERY = 'DELIVERY',
  OTHER = 'OTHER',
}

export enum WorkOrderLossChargeToEnum {
  VENDOR = 'VENDOR',
  CUSTOMER = 'CUSTOMER',
  OUR_COMPANY = 'OUR_COMPANY',
}

export class CreateLossIncidentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount!: number;

  @IsEnum(WorkOrderLossReasonCodeEnum)
  reasonCode!: WorkOrderLossReasonCodeEnum;

  @IsString()
  @MaxLength(500)
  reasonNote!: string;

  @IsEnum(WorkOrderLossChargeToEnum)
  chargeTo!: WorkOrderLossChargeToEnum;

  @IsOptional()
  @IsUUID()
  workOrderLotId?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
