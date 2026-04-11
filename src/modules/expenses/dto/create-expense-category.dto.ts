import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsBoolean()
  requiresPerson?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
