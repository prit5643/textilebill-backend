import { IsBoolean, IsDateString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalaryProfileDto {
  @IsUUID()
  personId!: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  monthlyGross?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  monthlySalary?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
