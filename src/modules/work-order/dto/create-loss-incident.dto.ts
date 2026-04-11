import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export enum WorkOrderLossReasonCodeDto {
  QUALITY_DEFECT = 'QUALITY_DEFECT',
  SHORTAGE = 'SHORTAGE',
  REWORK = 'REWORK',
  DAMAGE = 'DAMAGE',
  OTHER = 'OTHER',
}

export enum WorkOrderLossChargeToDto {
  OUR_COMPANY = 'OUR_COMPANY',
  VENDOR = 'VENDOR',
  CUSTOMER = 'CUSTOMER',
}

export class CreateLossIncidentDto {
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @IsOptional()
  @IsUUID()
  vendorAccountId?: string;

  @IsDateString()
  incidentDate: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  impactedQty?: number;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(WorkOrderLossReasonCodeDto)
  reasonCode: WorkOrderLossReasonCodeDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reasonNote: string;

  @IsEnum(WorkOrderLossChargeToDto)
  chargeTo: WorkOrderLossChargeToDto;
}
