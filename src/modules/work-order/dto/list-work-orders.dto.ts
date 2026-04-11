import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum WorkOrderStatusFilterDto {
  DRAFT = 'DRAFT',
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  READY_TO_BILL = 'READY_TO_BILL',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export class ListWorkOrdersDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(WorkOrderStatusFilterDto)
  status?: WorkOrderStatusFilterDto;
}
