import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCompanySettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ewayBillUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ewayBillPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  einvoiceUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  einvoicePassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultFinancialYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryBankBookAccount?: string;

  @ApiPropertyOptional({ example: 'date-wise' })
  @IsOptional()
  @IsString()
  defaultDateFilter?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  defaultFilterDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showAllFyInvoices?: boolean;

  @ApiPropertyOptional({ example: 'Roboto' })
  @IsOptional()
  @IsString()
  pdfFontFamily?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  pdfFontSize?: number;

  @ApiPropertyOptional({ example: 'percentage' })
  @IsOptional()
  @IsString()
  discountMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showRevenueAccount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showShipping?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showPlaceOfSupply?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  changeTaxPerProduct?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ example: 'retail' })
  @IsOptional()
  @IsString()
  priceSelection?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partyWisePricing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  posRateMode?: boolean;

  @ApiPropertyOptional({ example: 'FIFO' })
  @IsOptional()
  @IsString()
  closingStockMethod?: string;
}
