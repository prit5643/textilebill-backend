import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OtpVerifyDto {
  @ApiProperty({ example: '12a3b456-7890-4cde-f123-4567890abcd1' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value, obj }) => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof obj?.requestID === 'string' && obj.requestID.trim()) {
      return obj.requestID.trim();
    }

    return value;
  })
  requestId: string;

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

  @IsOptional()
  @IsString()
  requestID?: string;

  @IsOptional()
  @IsString()
  otpCode?: string;

  @IsOptional()
  @IsString()
  code?: string;
}
