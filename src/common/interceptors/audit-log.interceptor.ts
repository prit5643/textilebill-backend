import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
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

    const companyId = request.companyId || null;
    const tenantId = request.user?.tenantId || null;
    const controller = context.getClass().name;
    const handler = context.getHandler().name;

    return next.handle().pipe(
      tap({
        next: (data) => {
          const userId =
            request.user?.id ||
            request.res?.locals?.auditUserId ||
            data?.user?.id ||
            null;

          // Fire and forget audit log
          this.prisma.auditLog
            .create({
              data: {
                tenantId,
                companyId,
                userId,
                action: `${method} ${handler}`,
                entity: controller.replace('Controller', ''),
                entityId: data?.id || request.params?.id || null,
                newValue:
                  method === 'DELETE'
                    ? null
                    : typeof data === 'object'
                      ? data
                      : null,
                ipAddress: request.ip || request.headers['x-forwarded-for'],
                userAgent: request.headers['user-agent'],
              },
            })
            .catch(() => {
              /* ignore audit failures */
            });
        },
      }),
    );
  }
}
