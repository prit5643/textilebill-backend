# Test Scenarios Guide

## Test Environment Baseline

Run once before functional scenarios:

```bash
npm run db:setup
```

Then start API:

```bash
npm run start:dev
```

## Scenario 1: First-Run Readiness

Goal:

- Ensure app blocks normal traffic when required schema/data is missing.

Checks:

1. `GET /api/system/health` -> `200`
2. `GET /api/system/readiness` -> `200` when ready, `503` when setup missing
3. Regular protected API should return `503` when readiness fails

Expected:

- Backend logs detailed cause.
- Client sees sanitized message only.

## Scenario 2: Bootstrap Idempotency

Goal:

- Ensure bootstrap does not overwrite existing data.

Steps:

1. Run `npm run db:bootstrap`
2. Run `npm run db:bootstrap` again
3. Verify:
   - no duplicate super admin
   - no duplicate account groups
   - no existing user/company settings overwritten

## Scenario 3: Invoice Create (Core Happy Path)

Prerequisites (required):

1. Authenticated user with valid company access.
2. Active financial year selected.
3. Company has GSTIN configured.
4. At least one account (customer/supplier).
5. At least one product.
6. Valid invoice items with quantity/rate.

Optional:

- broker
- narration
- payment mode/book
- place of supply (if omitted, default intra-state logic applies)

Main API:

- `POST /api/invoices`

Validate after create:

1. Invoice exists with expected totals.
2. Invoice items created.
3. Stock movements created when config says stock effect.
4. Ledger entries created when config says ledger effect.

## Scenario 4: Invoice Validation Fail Cases

Case A:

- Missing GSTIN on company.
- Expect: `400` with business-safe message.

Case B:

- Auto-numbering disabled and no invoice number provided.
- Expect: `400`.

Case C:

- Invalid item payload (negative qty/rate).
- Expect: validation failure from DTO.

Case D:

- Concurrency conflict (`Product.version` mismatch).
- Expect: `409` conflict.

## Scenario 5: Authorization

Goal:

- Ensure role and subscription checks are enforced.

Checks:

1. User without required role -> `403`
2. Non-super-admin without active subscription -> `403`
3. Deactivated account -> blocked at auth strategy

## Scenario 6: Accounting Prerequisites

For cash/bank operations:

- required account groups must exist:
  - `Cash-in-Hand`
  - `Bank Accounts`

If missing:

- expect controlled business error (no raw SQL/Prisma leak).

## Scenario 7: Voucher Number Sequence + Ledger Carry-Forward

Goal:

- Ensure numbering is deterministic and collision-safe.
- Ensure running balances remain correct across paginated ledger pages.

Checks:

1. Create multiple cash/bank/journal entries in the same FY + series.
2. Verify voucher numbers increment monotonically (`<SERIES>-<FY>-<NNNN>`).
3. Create entries in a new FY and verify the sequence resets to `0001`.
4. Query ledger with pagination and verify page-N opening balance equals page-(N-1) closing balance.

Expected:

- No duplicate voucher numbers under normal concurrent load.
- Ledger running balance is stable and mathematically correct across pages.

## Scenario 8: Auth Abuse Protection + Secret Handling

Goal:

- Ensure sensitive data is not exposed and high-risk auth endpoints are throttled.

Checks:

1. Trigger repeated requests against:
   - `POST /api/auth/login`
   - `POST /api/auth/forgot-password`
   - `POST /api/auth/reset-password`
2. Verify throttling returns `429` with a structured JSON body.
3. Verify forgot-password flow does not log OTP secrets.
4. Verify user/tenant creation responses never include temporary password values.

Expected:

- Auth abuse is rate-limited consistently.
- Secrets are not returned or logged.

## Scenario 9: Hot Endpoint Lightweight Views

Goal:

- Ensure selector/header endpoints return only required fields.

Checks:

1. `GET /api/accounts?view=selector`
2. `GET /api/products?view=selector`
3. `GET /api/companies?view=header`
4. Compare payload shape against UI needs (dropdown/header use-cases).

Expected:

- Lightweight view responses contain only minimal list fields.
- Default list endpoints remain backward compatible for full list pages.

## Failure Meaning (for all scenarios)

Treat as failure if:

1. Frontend receives raw DB/Prisma details.
2. API returns `500` for known business validation conditions.
3. Duplicate baseline records are created by repeated bootstrap.
4. Existing baseline data is overwritten by bootstrap.

## Code Pointers For Scenario Assertions

- Invoice flow: `src/modules/invoice/invoice.service.ts`
- Accounting flow: `src/modules/accounting/accounting.service.ts`
- Voucher sequencing: `src/modules/accounting/voucher-number.service.ts`
- DTO validation: `src/modules/**/dto/*.ts`
- Error sanitization: `src/common/filters/global-exception.filter.ts`
- Readiness gate: `src/modules/system/*`
- Auth throttling: `src/modules/auth/auth-rate-limit.util.ts`, `src/main.ts`
- Request observability: `src/common/interceptors/logging.interceptor.ts`
