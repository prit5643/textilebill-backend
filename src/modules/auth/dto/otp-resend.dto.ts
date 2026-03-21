import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class OtpResendDto {
  @ApiProperty({ example: '12a3b456-7890-4cde-f123-4567890abcd1' })
  @IsString()
  @IsNotEmpty()
  requestId: string;
}
