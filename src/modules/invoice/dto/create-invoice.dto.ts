import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum InvoiceTypeEnum {
  SALE = 'SALE',
  PURCHASE = 'PURCHASE',
  QUOTATION = 'QUOTATION',
  CHALLAN = 'CHALLAN',
  PROFORMA = 'PROFORMA',
  SALE_RETURN = 'SALE_RETURN',
  PURCHASE_RETURN = 'PURCHASE_RETURN',
  JOB_IN = 'JOB_IN',
  JOB_OUT = 'JOB_OUT',
}

export enum InvoiceStatusEnum {
  ACTIVE = 'ACTIVE',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  DRAFT = 'DRAFT',
}

export class CreateInvoiceItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(28)
  gstRate?: number;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CreateInvoiceDto {
  @IsEnum(InvoiceTypeEnum)
  invoiceType: InvoiceTypeEnum;

  @IsOptional()
  @IsString()
  invoiceNumber?: string; // auto-generated if blank

  @IsDateString()
  invoiceDate: string;

  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsUUID()
  brokerId?: string;

  @IsOptional()
  @IsString()
  coChallanNo?: string;

  @IsOptional()
  @IsString()
  partyChallanNo?: string;

  @IsOptional()
  @IsString()
  hsnCodeHeader?: string;

  @IsOptional()
  @IsBoolean()
  taxInclusiveRate?: boolean;

  @IsOptional()
  @IsString()
  narration?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsString()
  placeOfSupply?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedAmount?: number;

  @IsOptional()
  @IsString()
  paymentMode?: string;

  @IsOptional()
  @IsString()
  paymentBookName?: string;

  @IsOptional()
  @IsString()
  paymentNarration?: string;

  @IsOptional()
  @IsEnum(InvoiceStatusEnum)
  status?: InvoiceStatusEnum;

  @IsOptional()
  @IsUUID()
  convertedFromId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];
}
