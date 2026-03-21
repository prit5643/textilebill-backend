import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Extracts companyId from X-Company-Id header (set by frontend after company selection)
 * and injects it into request for downstream services.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const headerValue = req.headers['x-company-id'];
    const companyId =
      typeof headerValue === 'string' ? headerValue.trim() : undefined;

    if (companyId) {
      req.companyId = companyId;
    }
    next();
  }
}
