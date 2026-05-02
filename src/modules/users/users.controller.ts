import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateMyProfileDto, UpdateUserDto } from './dto';
import {
  buildAvatarFilename,
  detectAvatarImageExtension,
  isAllowedAvatarMimeType,
} from './avatar-upload.util';
import {
  CompanyAccessGuard,
  JwtAuthGuard,
  RolesGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentUser,
  RequireCompanyAccess,
  Roles,
} from '../../common/decorators';

const avatarUploadDir = join(process.cwd(), 'uploads', 'avatars');
if (!existsSync(avatarUploadDir)) {
  mkdirSync(avatarUploadDir, { recursive: true });
}

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, SubscriptionGuard, CompanyAccessGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  async getMyProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.getMyProfile(userId, tenantId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMyProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.usersService.updateMyProfile(userId, tenantId, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload current user avatar' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req: any, file: any, cb: any) => {
        const isImage = isAllowedAvatarMimeType(file.mimetype);
        if (!isImage) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 1 * 1024 * 1024,
      },
    }),
  )
  async uploadMyAvatar(
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Avatar file is required');
    }

    const extension = detectAvatarImageExtension(file.buffer);
    if (!extension) {
      throw new BadRequestException('Invalid image file');
    }

    const filename = buildAvatarFilename(userId, extension);
    await writeFile(join(avatarUploadDir, filename), file.buffer);

    const safeAvatarUrl = `/uploads/avatars/${filename}`;
    return this.usersService.updateMyAvatar(userId, tenantId, safeAvatarUrl);
  }

  @Post()
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Create a new user (Admin only)' })
  async create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.create(tenantId, dto);
  }

  @Post(':id/resend-setup-link')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Resend password setup link (Admin only)' })
  async resendSetupLink(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.resendSetupLink(id, tenantId);
  }

  @Post(':id/send-password-reset-link')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Send password reset link by admin override (Admin only)',
  })
  async sendPasswordResetLink(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.adminSendPasswordResetLink(id, tenantId);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'List all users for current tenant' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.usersService.findAll(tenantId, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.findById(id, tenantId);
  }

  @Patch(':id')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Soft-delete user (deactivate)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.usersService.softDelete(id, tenantId);
    return { message: 'User deactivated' };
  }

  @Get(':id/sessions')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'List active sessions for a user' })
  async getSessions(@Param('id') id: string) {
    return this.usersService.getSessions(id);
  }

  @Delete(':id/sessions/:tokenId')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Revoke a specific user session' })
  async revokeSession(
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.usersService.revokeSession(id, tokenId);
  }

  @Get(':id/company-access')
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'List user company assignments' })
  async getCompanyAccess(
    @Param('id') id: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.getCompanyAccess(id, { role, tenantId });
  }

  @Post(':id/company-access')
  @RequireCompanyAccess({ source: 'body', key: 'companyId' })
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Assign user to a company' })
  async addCompanyAccess(
    @Param('id') id: string,
    @Body('companyId') companyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.usersService.addCompanyAccess(id, companyId, {
      role,
      tenantId,
    });
  }

  @Delete(':id/company-access/:companyId')
  @RequireCompanyAccess({ source: 'param', key: 'companyId' })
  @Roles('TENANT_ADMIN')
  @ApiOperation({ summary: 'Remove user from a company' })
  async removeCompanyAccess(
    @Param('id') id: string,
    @Param('companyId') companyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.usersService.removeCompanyAccess(id, companyId, {
      role,
      tenantId,
    });
    return { message: 'Access removed' };
  }
}
