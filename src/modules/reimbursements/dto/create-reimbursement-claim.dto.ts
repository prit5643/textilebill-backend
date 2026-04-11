import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReimbursementClaimDto {
  @IsUUID()
  personId!: string;

  @IsDateString()
  claimDate!: string;

  @IsNumber()
  @Type(() => Number)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
