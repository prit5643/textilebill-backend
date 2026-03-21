import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PasswordResetLinkRequestDto {
  @ApiProperty({
    example: 'customer@example.com',
    description: 'Email or mobile number used to find the account',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
