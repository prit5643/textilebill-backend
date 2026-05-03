import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  CurrentUser,
  RequireCompanyAccess,
} from '../../common/decorators';
import { InvoiceService } from './invoice.service';
import { PdfService } from './pdf.service';
import { CreateInvoiceDto, RecordPaymentDto, UpdateInvoiceDto } from './dto';

@Controller('invoices')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard)
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly pdfService: PdfService,
  ) {}

  @Post()
  create(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Body() dto: CreateInvoiceDto,
  ) {
    const financialYearId =
      (req.headers['x-financial-year-id'] as string) || null;
    return this.invoiceService.create(companyId, financialYearId, userId, dto);
  }

  @Get()
  findAll(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('invoiceType') invoiceType?: string,
    @Query('status') status?: string,
    @Query('accountId') accountId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.invoiceService.findAll(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      invoiceType,
      status,
      accountId,
      fromDate,
      toDate,
    });
  }

  @Get('summary')
  getSummary(
    @CurrentCompanyId() companyId: string,
    @Query('financialYearId') financialYearId?: string,
  ) {
    return this.invoiceService.getSummary(companyId, financialYearId);
  }

  @Get(':id')
  findById(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.invoiceService.findById(companyId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentCompanyId() companyId: string,
    @Res() res: Response,
    @Param('id') id: string,
    @Headers('origin') origin?: string,
  ) {
    const invoice = await this.invoiceService.findById(companyId, id);
    const company = await this.invoiceService.getCompany(companyId);
    const buffer = await this.pdfService.generateInvoicePdf(invoice, company);

    // @Res() bypasses NestJS interceptors including CORS — add headers explicitly
    if (origin) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
      });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Put(':id')
  update(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.invoiceService.remove(companyId, id);
  }

  // ─── Payments ───
  @Post(':id/payments')
  recordPayment(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoiceService.recordPayment(companyId, id, dto);
  }

  @Get(':id/payments')
  getPayments(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.invoiceService.getPayments(companyId, id);
  }

  @Delete(':id/payments/:paymentId')
  deletePayment(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.invoiceService.deletePayment(companyId, id, paymentId);
  }

  // ─── Conversion ───
  @Post(':id/convert')
  convertInvoice(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('targetType') targetType: string,
  ) {
    return this.invoiceService.convertInvoice(
      companyId,
      id,
      targetType as any,
      userId,
    );
  }
}
