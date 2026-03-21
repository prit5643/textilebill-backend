import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ProductTypeEnum {
  GOODS = 'GOODS',
  SERVICES = 'SERVICES',
}

export enum GstConsiderAsEnum {
  TAXABLE = 'TAXABLE',
  NIL_RATED = 'NIL_RATED',
  EXEMPTED = 'EXEMPTED',
  ZERO_RATED = 'ZERO_RATED',
  NON_GST = 'NON_GST',
  REVERSE_CHARGE = 'REVERSE_CHARGE',
}

export class CreateProductDto {
  @ApiProperty({ example: 'Blue Silk Saree' })
  @IsString()
  @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ example: 'BSS001' })
  @IsOptional()
  @IsString()
  searchCode?: string;

  @ApiPropertyOptional({ example: '5007' })
  @IsOptional()
  @IsString()
  hsnCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sacCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 2500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  retailPrice?: number;

  @ApiPropertyOptional({ example: 2000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  buyingPrice?: number;

  @ApiPropertyOptional({ example: 3000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  mrp?: number;

  @ApiPropertyOptional({ example: 2200.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  wholesalerPrice?: number;

  @ApiPropertyOptional({ example: 2100.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  distributorPrice?: number;

  @ApiPropertyOptional({ example: 5.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gstRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uomId?: string;

  @ApiPropertyOptional({ enum: ProductTypeEnum })
  @IsOptional()
  @IsEnum(ProductTypeEnum)
  type?: ProductTypeEnum;

  @ApiPropertyOptional({ enum: GstConsiderAsEnum })
  @IsOptional()
  @IsEnum(GstConsiderAsEnum)
  gstConsiderAs?: GstConsiderAsEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  defaultQty?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  defaultDiscount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minimumQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField3?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField5?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customField6?: string;
}
