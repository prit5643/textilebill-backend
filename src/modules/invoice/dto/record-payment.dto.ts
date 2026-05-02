import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RecordPaymentDto {
  @IsDateString()
  paymentDate: string;

  @IsNumber()
  @Min(0.01)
  @Max(10_000_000, {
    message: 'Payment amount cannot exceed ₹1 crore per transaction.',
  })
  amount: number;

  @IsString()
  paymentMode: string;

  @IsOptional()
  @IsString()
  bookName?: string;

  @IsOptional()
  @IsString()
  chequeNumber?: string;

  @IsOptional()
  @IsString()
  narration?: string;
}
