import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdatePagePermissionsDto {
  @ApiProperty({
    description:
      'Page permissions map. Each key contains enabled/editable boolean values.',
    example: {
      invoices: { enabled: true, editable: false },
      accounts: { enabled: true, editable: true },
    },
    type: Object,
  })
  @IsObject()
  permissions: Record<string, { enabled?: boolean; editable?: boolean }>;
}
