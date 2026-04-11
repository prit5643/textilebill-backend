import { IsNotEmpty, IsUUID } from 'class-validator';

export class LinkSaleInvoiceDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;
}
