import { IsUUID } from 'class-validator';

export class LinkInvoiceDto {
  @IsUUID()
  invoiceId!: string;
}
