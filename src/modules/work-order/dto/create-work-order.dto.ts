import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWorkOrderDto {
  @IsUUID()
  @IsNotEmpty()
  customerAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  itemName: string;

  @IsNumber()
  @Min(0.001)
  orderedQty: number;

  @IsNumber()
  @Min(0)
  saleRate: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
