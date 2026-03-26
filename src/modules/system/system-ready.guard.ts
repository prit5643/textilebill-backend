import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { SystemReadinessService } from './system-readiness.service';

@Injectable()
export class SystemReadyGuard implements CanActivate {
  private readonly excludedHealthPaths = new Set([
    '/health',
    '/api/health',
    '/system/health',
    '/api/system/health',
    '/system/readiness',
    '/api/system/readiness',
  ]);

  constructor(private readonly readiness: SystemReadinessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path || request.url || '';

    if (this.isPathExcluded(path)) {
      return true;
    }

    const status = await this.readiness.check(false);
    if (status.ready) {
      return true;
    }

    throw new ServiceUnavailableException('Database migration required');
  }

  private isPathExcluded(path: string): boolean {
    if (!path) return false;

    const withoutQuery = path.split('?')[0] ?? '';
    const normalizedPath =
      withoutQuery !== '/' ? withoutQuery.replace(/\/+$/, '') : withoutQuery;

    return (
      normalizedPath.includes('/docs') ||
      this.excludedHealthPaths.has(normalizedPath)
    );
  }
}
