import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { CurrentCompanyId, RequireCompanyAccess } from '../../common/decorators';
import {
  CreateReimbursementClaimDto,
  SettleReimbursementClaimDto,
} from './dto';
import { ReimbursementsService } from './reimbursements.service';

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
}
