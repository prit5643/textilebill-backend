import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  CreateExpensePersonDto,
  UpdateExpenseDto,
  UpdateExpensePersonDto,
} from './dto';
import { isAllowedExpenseMimeType } from './expense-attachment.util';

const EXPENSE_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

@ApiTags('Expenses')
@ApiBearerAuth('access-token')
@RequireCompanyAccess()
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // ── People ─────────────────────────────────────
  @Post('people')
  @ApiOperation({ summary: 'Create expense person' })
  createPerson(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateExpensePersonDto,
  ) {
    return this.expensesService.createPerson(companyId, dto);
  }

  @Get('people')
  @ApiOperation({ summary: 'List expense people' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'personType', required: false })
  listPeople(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('personType') personType?: string,
  ) {
    return this.expensesService.listPeople(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      isActive,
      personType,
    });
  }

  @Patch('people/:id')
  @ApiOperation({ summary: 'Update expense person' })
  updatePerson(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpensePersonDto,
  ) {
    return this.expensesService.updatePerson(companyId, id, dto);
  }

  // ── Categories ─────────────────────────────────
  @Post('categories')
  @ApiOperation({ summary: 'Create expense category' })
  createCategory(
    @CurrentCompanyId() companyId: string,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    return this.expensesService.createCategory(companyId, dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List expense categories' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  listCategories(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.expensesService.listCategories(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      isActive,
    });
  }

  // ── Expenses ───────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Create expense entry' })
  createExpense(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.createExpense(companyId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List expense entries' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'sourceType', required: false })
  @ApiQuery({ name: 'hasAttachment', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  listExpenses(
    @CurrentCompanyId() companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('personId') personId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('hasAttachment') hasAttachment?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.expensesService.listExpenses(companyId, {
      page: page ? +page : undefined,
      limit: limit ? +limit : undefined,
      search,
      status,
      categoryId,
      personId,
      sourceType,
      hasAttachment,
      fromDate,
      toDate,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get expense entry by id' })
  getExpense(@CurrentCompanyId() companyId: string, @Param('id') id: string) {
    return this.expensesService.findExpenseById(companyId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update expense entry' })
  updateExpense(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.updateExpense(companyId, id, userId, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit expense entry' })
  submitExpense(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.expensesService.submitExpense(companyId, id, userId);
  }

  // ── Attachments ────────────────────────────────
  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload expense attachment' })
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
        fileSize: EXPENSE_ATTACHMENT_MAX_SIZE_BYTES,
      },
    }),
  )
  uploadAttachment(
    @CurrentCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') expenseId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.expensesService.uploadExpenseAttachment(
      companyId,
      expenseId,
      userId,
      file,
    );
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List expense attachments' })
  listAttachments(
    @CurrentCompanyId() companyId: string,
    @Param('id') expenseId: string,
  ) {
    return this.expensesService.listExpenseAttachments(companyId, expenseId);
  }

  @Delete('attachments/:attachmentId')
  @ApiOperation({ summary: 'Delete expense attachment' })
  deleteAttachment(
    @CurrentCompanyId() companyId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.expensesService.deleteExpenseAttachment(
      companyId,
      attachmentId,
    );
  }
}
