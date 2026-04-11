import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentCompanyId,
  CurrentUser,
  RequireCompanyAccess,
} from '../../common/decorators';
import {
  CreateReimbursementClaimDto,
  SettleReimbursementClaimDto,
} from './dto';
import { ReimbursementsService } from './reimbursements.service';
import { isAllowedExpenseMimeType } from '../expenses/expense-attachment.util';

@ApiTags('Reimbursements')
@ApiBearerAuth('access-token')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('reimbursements')
export class ReimbursementsController {
  constructor(private readonly reimbursementsService: ReimbursementsService) {}

  @Get('claims')
  @ApiOperation({ summary: 'List reimbursement claims' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  listClaims(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('personId') personId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.reimbursementsService.listClaims(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      status,
      personId,
      fromDate,
      toDate,
    });
  }

  @Post('claims')
  @ApiOperation({ summary: 'Create reimbursement claim' })
  createClaim(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateReimbursementClaimDto,
  ) {
    return this.reimbursementsService.createClaim(companyId, dto);
  }

  @Post('claims/:id/settle')
  @ApiOperation({ summary: 'Settle reimbursement claim' })
  settleClaim(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: SettleReimbursementClaimDto,
  ) {
    return this.reimbursementsService.settleClaim(companyId, id, dto);
  }

  @Post('claims/:id/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload reimbursement claim attachment' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
        if (!isAllowedExpenseMimeType(file.mimetype)) {
          return cb(
            new BadRequestException('Unsupported attachment type'),
            false,
          );
        }
        return cb(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  uploadClaimAttachment(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.reimbursementsService.uploadClaimAttachment(
      companyId,
      id,
      userId,
      file,
    );
  }

  @Get('claims/:id/attachments')
  @ApiOperation({ summary: 'List reimbursement claim attachments' })
  listClaimAttachments(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ) {
    return this.reimbursementsService.listClaimAttachments(companyId, id);
  }

  @Delete('attachments/:attachmentId')
  @ApiOperation({ summary: 'Delete reimbursement claim attachment' })
  deleteClaimAttachment(
    @CurrentCompanyId() companyId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.reimbursementsService.deleteClaimAttachment(
      companyId,
      attachmentId,
    );
  }
}
