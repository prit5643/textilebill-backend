import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsUUID,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { MOBILE_REGEX } from '../../../common/utils/validation.util';

export enum UserRoleEnum {
  TENANT_ADMIN = 'TENANT_ADMIN',
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
  ACCOUNTANT = 'ACCOUNTANT',
  VIEWER = 'VIEWER',
}

export class CreateUserDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'john_doe' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ example: 'TempPass123!', minLength: 8, description: 'If omitted, a secure invite link is emailed to the user.' })
  @IsString()
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ enum: UserRoleEnum, default: UserRoleEnum.STAFF })
  @IsEnum(UserRoleEnum)
  @IsOptional()
  role?: UserRoleEnum;

  @ApiPropertyOptional({ example: 'John' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(MOBILE_REGEX, {
    message: 'Invalid mobile number format',
  })
  phone?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Company IDs to assign for this user',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  companyIds?: string[];
}
