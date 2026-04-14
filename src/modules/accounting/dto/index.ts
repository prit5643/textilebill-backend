import {
  IsString,
  IsOptional,
  IsDateString,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCashBookEntryDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bookName?: string;
  @ApiProperty() @IsString() accountId: string;
  @ApiProperty({ enum: ['CR', 'DR'] }) @IsEnum(['CR', 'DR']) type: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() narration?: string;
}

export class CreateBankBookEntryDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bookName?: string;
  @ApiProperty() @IsString() accountId: string;
  @ApiProperty({ enum: ['CR', 'DR'] }) @IsEnum(['CR', 'DR']) type: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() chequeNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() narration?: string;
}

export class JournalEntryLineDto {
  @ApiProperty() @IsString() accountId: string;
  @ApiProperty({ enum: ['DR', 'CR'] }) @IsEnum(['DR', 'CR']) type: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() narration?: string;
}

export class CreateJournalEntryDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() narration?: string;
  @ApiProperty({ type: [JournalEntryLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];
}

export class CreateOpeningStockDto {
  @ApiProperty() @IsString() productId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
  @ApiProperty() @IsNumber() @Min(0) rate: number;
  @ApiProperty() @IsDateString() date: string;
}

export class CreateStockAdjustmentDto {
  @ApiProperty() @IsString() productId: string;
  @ApiProperty({ enum: ['ADD', 'REDUCE'] })
  @IsEnum(['ADD', 'REDUCE'])
  type: string;
  @ApiProperty() @IsNumber() quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiProperty() @IsDateString() date: string;
}

export class CreateOpeningBalanceDto {
  @ApiProperty() @IsString() accountId: string;
  @ApiProperty({ enum: ['DR', 'CR'] }) @IsEnum(['DR', 'CR']) type: string;
  @ApiProperty() @IsNumber() amount: number;
  @ApiProperty() @IsDateString() date: string;
}
