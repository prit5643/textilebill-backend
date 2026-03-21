# Data Validation Reference

## Request-Level Validation

Global setup in `src/main.ts`:

- `ValidationPipe` with:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`
  - `enableImplicitConversion: true`

Implication:

- Unknown fields are rejected.
- DTO decorators (`class-validator`) are enforced globally.
- Primitive types are transformed where possible.

## Error Sanitization

Global exception filter: `src/common/filters/global-exception.filter.ts`

- Converts technical/internal error messages to safe user messages.
- Logs full backend details for debugging.
- Includes request ID in response for traceability.

## Module DTO Validation Entry Points

1. Auth
   - `src/modules/auth/dto/*.ts`
2. Company
   - `src/modules/company/dto/*.ts`
3. Product
   - `src/modules/product/dto/*.ts`
4. Account
   - `src/modules/account/dto/*.ts`
5. Invoice
   - `src/modules/invoice/dto/*.ts`
6. Accounting
   - `src/modules/accounting/dto/index.ts`

## Business Validation (Service Layer)

Examples:

- Invoice creation requires company GSTIN:
  - `src/modules/invoice/invoice.service.ts`
- Prevent update of cancelled invoices:
  - `src/modules/invoice/invoice.service.ts`
- Concurrency safety for stock updates using `Product.version`:
  - `src/modules/invoice/invoice.service.ts`
- Subscription checks for non-super-admin users:
  - `src/common/guards/subscription.guard.ts`
- Roles-based authorization:
  - `src/common/guards/roles.guard.ts`

## Readiness Validation

System readiness checks validate:

- Required schema objects are present.
- Required baseline data exists (e.g. `SUPER_ADMIN`, core account groups).

Files:

- `src/modules/system/system-readiness.service.ts`
- `src/modules/system/system-ready.guard.ts`

Behavior:

- Backend logs exact technical issue.
- Frontend receives sanitized `503 Service Unavailable`.
