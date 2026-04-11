import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReverseLossIncidentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  reason: string;
}
