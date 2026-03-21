import { IsString, MinLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or mobile number used for OTP recovery',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value, obj }) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof obj?.email === 'string' && obj.email.trim()) {
      return obj.email.trim();
    }

    if (typeof obj?.emailId === 'string' && obj.emailId.trim()) {
      return obj.emailId.trim();
    }

    return value;
  })
  identifier: string;

  @ApiPropertyOptional({ example: 'user@example.com', description: 'Alias for identifier' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 'user@example.com', description: 'Alias for identifier' })
  @IsOptional()
  @IsString()
  emailId?: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value, obj }) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof obj?.otpCode === 'string' && obj.otpCode.trim()) {
      return obj.otpCode.trim();
    }

    if (typeof obj?.code === 'string' && obj.code.trim()) {
      return obj.code.trim();
    }

    return value;
  })
  otp: string;

  @ApiPropertyOptional({ example: '123456', description: 'Alias for otp' })
  @IsOptional()
  @IsString()
  otpCode?: string;

  @ApiPropertyOptional({ example: '123456', description: 'Alias for otp' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ example: 'NewPass@123' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
