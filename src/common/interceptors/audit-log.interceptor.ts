import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, finalize, tap } from 'rxjs';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const requestPath = (request.originalUrl || request.url || '/').split(
      '?',
    )[0];
    const routeTemplate = request.route?.path
      ? `${request.baseUrl || ''}${request.route.path}`
      : requestPath;
    const entity = this.extractEntity(routeTemplate, requestPath);
    const entityId = this.extractEntityId(
      request.params as Record<string, string>,
    );

    let hasError = false;

    return next.handle().pipe(
      tap({
        error: () => {
          hasError = true;
        },
      }),
      finalize(() => {
        const statusCode = response?.statusCode ?? (hasError ? 500 : 200);
        const actor = request.user;
        const companyId =
          request.companyId ||
          (typeof request.headers['x-company-id'] === 'string'
            ? request.headers['x-company-id']
            : null);
        const actorIdentifier = this.extractActorIdentifier(
          request.body as Record<string, unknown>,
        );
        const actorMetadata: Prisma.InputJsonObject = {
          userId: actor?.id ?? null,
          tenantId: actor?.tenantId ?? null,
          identifier: actorIdentifier,
        };

        const payload: Prisma.InputJsonObject = {
          actor: actorMetadata,
          params: this.redactSensitive(
            request.params as Record<string, unknown>,
          ) as Prisma.InputJsonValue,
          body: this.redactSensitive(
            request.body as Record<string, unknown>,
          ) as Prisma.InputJsonValue,
        };

        void this.prisma.auditLog
          .create({
            data: {
              tenantId: actor?.tenantId ?? null,
              companyId,
              userId: actor?.id ?? null,
              action: `${method} ${entity}`,
              entity,
              entityId,
              method,
              path: routeTemplate,
              statusCode,
              ipAddress: request.ip ?? null,
              userAgent:
                typeof request.headers['user-agent'] === 'string'
                  ? request.headers['user-agent']
                  : null,
              newValue: payload,
            },
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to persist audit log: ${message}`);
          });
      }),
    );
  }

  private extractActorIdentifier(
    body: Record<string, unknown> | undefined,
  ): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const candidateKeys = [
      'email',
      'loginId',
      'identifier',
      'username',
      'phone',
      'mobile',
    ];
    for (const key of candidateKeys) {
      const value = body[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private extractEntity(routeTemplate: string, requestPath: string): string {
    const normalized = (routeTemplate || requestPath)
      .replace(/^\/api(\/v\d+)?\//i, '')
      .replace(/^\//, '');
    const firstSegment = normalized.split('/').find((segment) => !!segment);
    if (!firstSegment) {
      return 'UNKNOWN';
    }

    return firstSegment.replace(/[-_]/g, ' ').toUpperCase();
  }

  private extractEntityId(
    params: Record<string, string> | undefined,
  ): string | null {
    if (!params) {
      return null;
    }

    const preferredKeys = [
      'id',
      'userId',
      'tenantId',
      'companyId',
      'invoiceId',
      'productId',
    ];
    for (const key of preferredKeys) {
      if (typeof params[key] === 'string' && params[key].trim().length > 0) {
        return params[key];
      }
    }

    const fallback = Object.values(params).find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    return fallback ?? null;
  }

  private redactSensitive(value: unknown, depth = 0): unknown {
    if (value == null) {
      return value;
    }

    if (depth > 4) {
      return '[TRUNCATED]';
    }

    if (typeof value === 'string') {
      return value.length > 1000
        ? `${value.slice(0, 1000)}...[TRUNCATED]`
        : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, 20)
        .map((entry) => this.redactSensitive(entry, depth + 1));
    }

    if (typeof value !== 'object') {
      return '[UNSUPPORTED]';
    }

    const source = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    const sensitiveKeys = new Set([
      'password',
      'passwordHash',
      'pwd',
      'otp',
      'token',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
      'secret',
    ]);

    for (const [key, item] of Object.entries(source)) {
      if (sensitiveKeys.has(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = this.redactSensitive(item, depth + 1);
      }
    }

    return redacted;
  }
}
