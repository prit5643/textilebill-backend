import { IsOptional, Matches } from 'class-validator';

export class WorkOrderReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'from must be in YYYY-MM format',
  })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'to must be in YYYY-MM format',
  })
  to?: string;
}
