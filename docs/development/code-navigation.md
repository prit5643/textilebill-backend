# Code Navigation Guide

## Backend Entry

- App bootstrap: `src/main.ts`
- Root module wiring: `src/app.module.ts`
- Prisma service: `src/modules/prisma/prisma.service.ts`

## Security & RBAC (Role-Based Access Control)

- JWT authentication guard: `src/common/guards/jwt-auth.guard.ts`
- **Role resolution (`UserRole` -> Legacy roles):** `src/modules/auth/auth.service.ts` -> `toLegacyRole()` mapper.
- **Backend endpoint protection:** Use `@Roles('SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER')` on your Controller classes.
- Multi-Company Access Guard: `src/common/guards/company-access.guard.ts` checks the `UserCompany` mapping for the specific `X-Company-Id` context.
- Request ID middleware: `src/common/middleware/request-id.middleware.ts`
- Auth limiter utilities: `src/modules/auth/auth-rate-limit.util.ts`
- Request logging interceptor: `src/common/interceptors/logging.interceptor.ts`
- Runtime config helpers: `src/common/utils/config-value.util.ts`

## System Readiness / Deployment Safety

- Readiness service: `src/modules/system/system-readiness.service.ts`
- Readiness guard: `src/modules/system/system-ready.guard.ts`
- Health endpoints: `src/modules/system/system.controller.ts`

## Core Business Modules

- Auth: `src/modules/auth/*`
- Admin: `src/modules/admin/*`
- Company: `src/modules/company/*`
- Product: `src/modules/product/*`
- Account: `src/modules/account/*`
- Invoice: `src/modules/invoice/*`
- Accounting: `src/modules/accounting/*`
- Reports: `src/modules/report/*`

## Issue 11-15 Hotspots

- Voucher number allocator: `src/modules/accounting/voucher-number.service.ts`
- Voucher sequence persistence model: `prisma/schema.prisma` (`VoucherSequence`)
- Ledger running-balance path: `src/modules/accounting/accounting.service.ts`
- Lightweight payload views:
  - `src/modules/account/account.service.ts`
  - `src/modules/product/product.service.ts`
  - `src/modules/company/company.service.ts`
- Swagger production gating: `src/main.ts`, `src/config/app.config.ts`

## Database & Bootstrap

- Prisma schema: `prisma/schema.prisma`
- SQL migrations: `prisma/migrations/*`
- Data bootstrap seed: `prisma/seed.ts`
- DB create-if-missing script: `scripts/db-ensure.ts`

## How To Add A New Field Safely

1. Update model in `prisma/schema.prisma`.
2. Create migration in development.
3. Update DTO validations in `src/modules/<module>/dto`.
4. Update service logic and tests.
5. If baseline data required, update `prisma/seed.ts` with create-missing-only logic.
6. Update docs in `docs/`.

## How To Trace An Error

1. Use `x-request-id` from API response.
2. Find backend logs for same request ID.
3. Check exception mapping in global filter.
4. If `503`, check readiness logs from `SystemReadinessService`.
