import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { InvoiceTypeEnum } from './create-invoice.dto';

export class CreateInvoiceNumberConfigDto {
  @IsEnum(InvoiceTypeEnum)
  invoiceType: InvoiceTypeEnum;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  startingNumber?: number;

  @IsOptional()
  @IsBoolean()
  isAutoNumber?: boolean;

  @IsOptional()
  @IsString()
  gstType?: string;

  @IsOptional()
  @IsBoolean()
  stockEffect?: boolean;

  @IsOptional()
  @IsBoolean()
  ledgerEffect?: boolean;
}

export class UpdateInvoiceNumberConfigDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  startingNumber?: number;

  @IsOptional()
  @IsBoolean()
  isAutoNumber?: boolean;

  @IsOptional()
  @IsString()
  gstType?: string;

  @IsOptional()
  @IsBoolean()
  stockEffect?: boolean;

  @IsOptional()
  @IsBoolean()
  ledgerEffect?: boolean;
}
