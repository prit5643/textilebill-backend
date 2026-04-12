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
  Matches,
  ArrayMinSize,
  IsNotEmpty,
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
  @IsNotEmpty()
  productId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1, { message: 'Quantity must be at least 1' })
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
  @IsNotEmpty()
  invoiceType: InvoiceTypeEnum;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message:
      'Bill number must be strictly numeric (e.g. 1, 2, 3). Do not include prefixes like SAL- or PUR-.',
  })
  invoiceNumber?: string; // auto-generated if blank; if provided must be pure numeric

  @IsDateString()
  @IsNotEmpty()
  invoiceDate: string;

  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

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
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];
}
