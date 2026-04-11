import { IsNotEmpty, IsUUID } from 'class-validator';

export class LinkPurchaseInvoiceDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;
}
