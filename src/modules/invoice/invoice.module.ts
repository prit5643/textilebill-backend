import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceNumberService } from './invoice-number.service';
import { PdfService } from './pdf.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceNumberConfigController } from './invoice-number-config.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvoiceController, InvoiceNumberConfigController],
  providers: [InvoiceService, InvoiceNumberService, PdfService],
  exports: [InvoiceService, InvoiceNumberService, PdfService],
})
export class InvoiceModule {}
