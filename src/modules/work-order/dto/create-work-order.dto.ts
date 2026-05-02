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
import { Type } from 'class-transformer';

export class CreateWorkOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  orderRef!: string;

  @IsUUID()
  customerAccountId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  itemName!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Type(() => Number)
  orderedQuantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  saleRate!: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
