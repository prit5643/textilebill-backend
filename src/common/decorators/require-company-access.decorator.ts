import { SetMetadata } from '@nestjs/common';

export const COMPANY_ACCESS_KEY = 'company-access';

export type CompanyAccessSource = 'header' | 'param' | 'body';

export interface RequireCompanyAccessOptions {
  source?: CompanyAccessSource;
  key?: string;
}

export const RequireCompanyAccess = (
  options: RequireCompanyAccessOptions = {},
) =>
  SetMetadata(COMPANY_ACCESS_KEY, {
    source: options.source ?? 'header',
    key:
      options.key ??
      (options.source === 'param'
        ? 'id'
        : options.source === 'body'
          ? 'companyId'
          : 'x-company-id'),
  } satisfies Required<RequireCompanyAccessOptions>);
