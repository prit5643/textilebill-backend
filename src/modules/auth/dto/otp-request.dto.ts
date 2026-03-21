import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class OtpRequestDto {
  @ApiProperty({
    example: 'owner@example.com',
    description: 'Username, email, or phone number used to identify the account',
  })
  @IsString()
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

  @ApiPropertyOptional({
    example: 'owner@example.com',
    description: 'Alias for identifier',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    example: 'owner@example.com',
    description: 'Alias for identifier',
  })
  @IsOptional()
  @IsString()
  emailId?: string;

  @ApiPropertyOptional({
    example: 'EMAIL',
    enum: ['EMAIL'],
    description: 'OTP delivery channel',
  })
  @IsOptional()
  @IsIn(['EMAIL'])
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  channel?: 'EMAIL';
}
