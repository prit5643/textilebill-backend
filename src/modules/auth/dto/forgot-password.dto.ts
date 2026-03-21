import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email or mobile number' })
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

  @ApiProperty({
    example: 'EMAIL',
    enum: ['EMAIL'],
    description: 'OTP delivery channel',
  })
  @IsString()
  @IsIn(['EMAIL'])
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  channel: 'EMAIL';
}
