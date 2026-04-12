import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { join, normalize, sep } from 'path';
import { isValidExpenseAttachmentFilename } from './expense-attachment.util';

const expenseUploadDir = join(process.cwd(), 'uploads', 'expenses');
const normalizedExpenseUploadDir = normalize(`${expenseUploadDir}${sep}`);

const ATTACHMENT_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@ApiExcludeController()
@Controller('uploads/expenses')
export class ExpenseUploadsController {
  @Get(':filename')
  serveAttachment(
    @Param('filename') filename: string,
    @Res() response: Response,
  ): void {
    if (!isValidExpenseAttachmentFilename(filename)) {
      throw new BadRequestException('Invalid attachment filename');
    }

    const absolutePath = normalize(join(expenseUploadDir, filename));
    if (!absolutePath.startsWith(normalizedExpenseUploadDir)) {
      throw new BadRequestException('Invalid attachment path');
    }

    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Attachment not found');
    }

    const extension = filename.split('.').pop()?.toLowerCase() || 'pdf';
    response.setHeader(
      'Content-Type',
      ATTACHMENT_CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.sendFile(absolutePath);
  }
}
