import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { join, normalize, sep } from 'path';
import { JwtAuthGuard } from '../../common/guards';
import { isValidAvatarFilename } from './avatar-upload.util';

const avatarUploadDir = join(process.cwd(), 'uploads', 'avatars');
const normalizedAvatarUploadDir = normalize(`${avatarUploadDir}${sep}`);

const AVATAR_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

@ApiExcludeController()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UploadsController {
  @Get('avatars/:filename')
  serveAvatar(
    @Param('filename') filename: string,
    @Res() response: Response,
  ): void {
    if (!isValidAvatarFilename(filename)) {
      throw new BadRequestException('Invalid avatar filename');
    }

    const absolutePath = normalize(join(avatarUploadDir, filename));
    if (!absolutePath.startsWith(normalizedAvatarUploadDir)) {
      throw new BadRequestException('Invalid avatar path');
    }

    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Avatar not found');
    }

    const extension = filename.split('.').pop()?.toLowerCase() || 'jpg';
    response.setHeader(
      'Content-Type',
      AVATAR_CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.sendFile(absolutePath);
  }
}
