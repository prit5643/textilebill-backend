import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class VerifyContactRequestDto {
  @ApiProperty({
    example: 'EMAIL',
    enum: ['EMAIL'],
    description: 'Channel to verify for the authenticated user',
  })
  @IsIn(['EMAIL'])
  channel: 'EMAIL';
}
