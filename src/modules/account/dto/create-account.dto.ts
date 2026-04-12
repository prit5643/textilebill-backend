import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsEmail,
  IsDateString,
  MaxLength,
  Matches,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  GSTIN_REGEX,
  MOBILE_REGEX,
} from '../../../common/utils/validation.util';

export enum GstTypeEnum {
  REGULAR = 'REGULAR',
  COMPOSITION = 'COMPOSITION',
  UNREGISTERED = 'UNREGISTERED',
  CONSUMER = 'CONSUMER',
  SEZ = 'SEZ',
  DEEMED_EXPORT = 'DEEMED_EXPORT',
}

export class CreateAccountDto {
  @ApiProperty({ example: 'Rajesh Textiles' })
  @IsString()
  @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ example: 'RT001' })
  @IsOptional()
  @IsString()
  searchCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

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

  @ApiPropertyOptional({ enum: GstTypeEnum })
  @IsOptional()
  @IsEnum(GstTypeEnum)
  gstType?: GstTypeEnum;

  @ApiPropertyOptional({ example: 'retail' })
  @IsOptional()
  @IsString()
  priceSelection?: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '395001' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Pincode must be a 6-digit number' })
  pincode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6}$/, {
    message: 'Shipping pincode must be a 6-digit number',
  })
  shippingPincode?: string;

  @ApiPropertyOptional({ example: 'Rajesh Shah' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(MOBILE_REGEX, {
    message: 'Invalid mobile number format',
  })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aadhar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brokerId?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  openingBalance?: number;

  @ApiPropertyOptional({ example: 'DR' })
  @IsOptional()
  @IsString()
  openingBalanceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  openingBalanceRemark?: string;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  creditLimit?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  @Max(365)
  paymentDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  marriageAnniversary?: string;

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
  bankAccountType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC format' })
  bankIfsc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankBranch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultInvoiceType?: string;

  @ApiPropertyOptional({ example: 5.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  partyDiscountRate?: number;
}
