import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({ example: 'c2d3e4f5-...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'MyNew$ecure1', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}
