import {
  IsString,
  IsOptional,
  IsEmail,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  GSTIN_REGEX,
  MOBILE_REGEX,
  NAME_REGEX,
} from '../../../common/utils/validation.util';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Shiv Fashion' })
  @IsString()
  @MaxLength(200)
  @Matches(NAME_REGEX, {
    message:
      "Company name can contain only letters, numbers, spaces, and & . ' / -",
  })
  name: string;

  @ApiPropertyOptional({ example: '24AABCU9603R1ZM' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(GSTIN_REGEX, {
    message: 'Invalid GSTIN format',
  })
  gstin?: string;

  @ApiPropertyOptional({ example: '123, Ring Road' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Surat' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Gujarat' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '395001' })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  pincode?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(MOBILE_REGEX, {
    message: 'Invalid mobile number format',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'info@shivfashion.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankIfsc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankBranch?: string;
}
