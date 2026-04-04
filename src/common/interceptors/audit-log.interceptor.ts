import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Only log mutating operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    // AuditLog model was removed in schema v2.
    // Keep interceptor behavior non-breaking while we move audit trail to app logs/events.
    return next.handle();
  }
}
