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
    // Avatars are overwritten at the same URL, so force revalidation to avoid stale photos.
    response.setHeader('Cache-Control', 'private, no-cache, max-age=0, must-revalidate');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.sendFile(absolutePath);
  }
}
