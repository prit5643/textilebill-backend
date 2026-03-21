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

    return (
      path.includes('/docs') ||
      path.endsWith('/system/health') ||
      path.endsWith('/system/readiness')
    );
  }
}
