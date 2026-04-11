import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalaryAdvanceDto {
  @IsUUID()
  personId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount!: number;

  @IsDateString()
  advanceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
