import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, finalize, tap } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  constructor(private readonly slowRequestMs = 1500) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method } = request;
    const requestId = request.headers['x-request-id'] || 'N/A';
    const requestPath = (request.originalUrl || request.url || '/').split(
      '?',
    )[0];
    const routeTemplate = request.route?.path
      ? `${request.baseUrl || ''}${request.route.path}`
      : requestPath;
    const companyId =
      request.companyId || request.headers['x-company-id'] || '-';
    const userId = request.user?.id || '-';
    const now = Date.now();
    let hasError = false;

    return next.handle().pipe(
      tap({
        error: () => {
          hasError = true;
        },
      }),
      finalize(() => {
        const statusCode = response?.statusCode ?? 500;
        const duration = Date.now() - now;
        response?.setHeader?.('x-response-time-ms', String(duration));

        const hasHttpError = hasError && statusCode >= 400;

        const logEvent = {
          event: 'http_request',
          method,
          path: requestPath,
          route: routeTemplate,
          statusCode,
          durationMs: duration,
          requestId,
          companyId,
          userId,
          hasError: hasHttpError,
          slow: duration >= this.slowRequestMs,
          timestamp: new Date().toISOString(),
        };
        const line = JSON.stringify(logEvent);

        if (hasHttpError || statusCode >= 500) {
          this.logger.error(line);
          return;
        }
        if (duration >= this.slowRequestMs) {
          this.logger.warn(line);
          return;
        }
        this.logger.log(line);
      }),
    );
  }
}
