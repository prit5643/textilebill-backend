import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReimbursementSettlementModeEnum {
  DIRECT_PAYMENT = 'DIRECT_PAYMENT',
  SALARY_ADDITION = 'SALARY_ADDITION',
  CARRY_FORWARD = 'CARRY_FORWARD',
}

export class SettleReimbursementClaimDto {
  @IsEnum(ReimbursementSettlementModeEnum)
  settlementMode!: ReimbursementSettlementModeEnum;

  @IsOptional()
  @IsString()
  note?: string;
}
