import { IsEnum, IsOptional, IsString, MaxLength, IsBoolean, IsUUID } from 'class-validator';

export enum PersonTypeEnum {
  PARTNER = 'PARTNER',
  MANAGER = 'MANAGER',
  WORKER = 'WORKER',
  ACCOUNTANT = 'ACCOUNTANT',
  OTHER = 'OTHER',
}

export class CreateExpensePersonDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEnum(PersonTypeEnum)
  personType?: PersonTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  linkedUserId?: string;
}
