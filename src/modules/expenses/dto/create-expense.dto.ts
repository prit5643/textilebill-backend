import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ExpenseSourceTypeEnum {
  COMPANY_CASH = 'COMPANY_CASH',
  COMPANY_BANK = 'COMPANY_BANK',
  PERSONAL = 'PERSONAL',
  PERSONAL_OUT_OF_POCKET = 'PERSONAL_OUT_OF_POCKET',
}

export enum ExpenseStatusEnum {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SETTLED = 'SETTLED',
}

export class CreateExpenseDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Type(() => Number)
  amount!: number;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsEnum(ExpenseSourceTypeEnum)
  sourceType?: ExpenseSourceTypeEnum;

  @IsOptional()
  @IsEnum(ExpenseStatusEnum)
  status?: ExpenseStatusEnum;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
