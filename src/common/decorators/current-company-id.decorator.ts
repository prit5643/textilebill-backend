import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const CurrentCompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ companyId?: string }>();
    const companyId = request.companyId;

    if (!companyId) {
      throw new BadRequestException('X-Company-Id header is required.');
    }

    return companyId;
  },
);
