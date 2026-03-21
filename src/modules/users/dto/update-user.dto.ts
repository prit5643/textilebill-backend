import {
  IsOptional,
  IsString,
  IsEnum,
  IsBoolean,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { UserRoleEnum } from './create-user.dto';
import { MOBILE_REGEX } from '../../../common/utils/validation.util';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: UserRoleEnum })
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

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
