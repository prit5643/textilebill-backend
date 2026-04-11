# Test Scenarios Guide

Last updated: `2026-03-30`

This guide reflects the schema-aligned backend and the current frontend/browser checks.

## Baseline Commands

Backend:

```bash
cd textilebill-backend
npm run db:setup
npm run start:dev
```

Frontend:

```bash
cd textilebill-frontend
npm run dev
```

## Scenario 1: Health and Readiness

Verify:

1. `GET /api/health` returns `200`
2. `GET /api/system/health` returns `200`
3. `GET /api/system/readiness` returns `200` when schema/defaults are ready
4. protected requests fail closed with `503` when readiness is not satisfied

## Scenario 2: Bootstrap Idempotency

Run:

```bash
npm run db:bootstrap
npm run db:bootstrap
```

Verify:

- no duplicate bootstrap tenant/company
- no duplicate owner user for the configured bootstrap email
- no duplicate `UserCompany` mapping
- no duplicate `VoucherSequence` rows

## Scenario 3: Auth Session Lifecycle

Verify:

1. login sets auth cookies
2. `GET /api/auth/me` returns current session
3. refresh rotates session state
4. logout clears cookies
5. revoked sessions cannot refresh

## Scenario 4: Invite / Reset / OTP Flows

Verify:

- OTP request, resend, and verify work through `OtpChallenge`
- password reset OTP flow works
- password reset link flow works
- invite/password-setup routes work without relying on removed legacy tables

## Scenario 5: Company and Financial Year

Verify:

- company create/list/update works
- compatibility settings endpoints still return valid payloads
- financial year create/list/activate works
- FY lock behavior is enforced where applicable

## Scenario 6: Account and Product Masters

Verify:

- account CRUD works through `Account + Party`
- account grouping uses `AccountGroupType`
- product CRUD works through current product fields
- selector/list payloads remain stable for frontend dropdowns

## Scenario 7: Invoice Happy Path

Prerequisites:

- authenticated user with company access
- active company selected
- active financial year
- at least one account
- at least one product

Verify after `POST /api/invoices`:

- invoice row created
- invoice items created
- stock movements created when required
- ledger entries created when required
- invoice summary/report endpoints reflect the new invoice

## Scenario 8: Invoice Failure Cases

Case A:

- Missing GSTIN on company.
- Expect: `400` with business-safe message.

Case B:

- Auto-numbering disabled and no invoice number provided.
- Expect: `400`.

Case C:

- Invoice number provided with non-numeric characters.
- Expect: `400` validation error.

Case D:

- Invalid item payload (negative qty/rate).
- Expect: validation failure from DTO.

Case E:

- Concurrency conflict (`Product.version` mismatch).
- Expect: `409` conflict.

Case F:

- Unsupported `invoiceType` value.
- Expect: `400` validation error.

## Scenario 9: Accounting and Voucher Sequences

Verify:

- accounting endpoints write through `LedgerEntry` and `StockMovement`
- voucher numbering increments per FY and `VoucherType`
- ledger running balances stay stable across pagination

## Scenario 10: Reports

Verify:

- dashboard and monthly chart
- debtors/creditors
- day book
- stock and product detail reports
- GST reports
- trial balance, profit/loss, balance sheet

All report queries must be based on current schema fields only.

## Scenario 11: Frontend Integration

Verify:

- frontend unit suite
- frontend production build
- Playwright flows for:
  - authentication
  - billing/subscription
  - dashboard data visibility
  - business flows
  - forms validation

## Current Verified Snapshot

Validated locally on `2026-03-30`:

- backend unit/integration: `57/57` suites passed, `252/252` tests
- backend e2e: `11` suites passed, `1` skipped, `56` tests passed, `1` skipped
- frontend unit: `26/26` suites passed, `112/112` tests
- frontend Playwright: `49/49` tests passed

## Failure Meaning

Treat as failure if:

1. client receives raw Prisma or SQL details
2. known business validation returns generic `500`
3. bootstrap duplicates baseline records
4. a route still depends on removed legacy persistence
