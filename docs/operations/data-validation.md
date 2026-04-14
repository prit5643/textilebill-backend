# Data Validation Reference

Last updated: `2026-03-30`

## Request Validation

Global validation is configured in `src/main.ts` with:

- `whitelist: true`
- `forbidNonWhitelisted: true`
- `transform: true`
- `enableImplicitConversion: true`

Effects:

- unknown fields are rejected
- DTO decorators are enforced globally
- primitive conversions are applied where possible

## Error Sanitization

`src/common/filters/global-exception.filter.ts`

- hides internal Prisma/DB details from clients
- logs technical detail server-side
- returns safe public messages

## DTO Entry Points

- auth DTOs: `src/modules/auth/dto/*`
- company DTOs: `src/modules/company/dto/*`
- product DTOs: `src/modules/product/dto/*`
- account DTOs: `src/modules/account/dto/*`
- invoice DTOs: `src/modules/invoice/dto/*`
- accounting DTOs: `src/modules/accounting/dto/*`

## Service-Level Guard Validation

Key business validation constraints:

- auth state, tenant status (e.g. `Suspended`, `Archived`), and JWT session validity checks
- **Company Access Guard (`UserCompany`)**: Validates that an incoming `X-Company-Id` header (or URL path parameter) is permitted by checking if the user-to-company association exists and what role they hold.
- **RBAC Validation (`@Roles()`)**: Controller endpoints explicitly whitelist or block user roles (e.g., stopping MANAGERS from modifying financial years or global settings). Only `SUPER_ADMIN` / `OWNER` can ignore these bounds implicitly. Includes subscription check guards.
- invoice arithmetic and versioning rules
- account/product existence and scoping checks
- voucher sequence and ledger/stock invariants

## Readiness Validation

`src/modules/system/system-readiness.service.ts`

Current readiness checks are based on active schema tables and bootstrap data, not legacy bootstrap-role assumptions or removed model assumptions.

Expected behavior:

- backend logs root cause
- client receives sanitized `503`
