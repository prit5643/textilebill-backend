# Backend Operations Handbook

Last updated: `2026-03-30`

This is the one-file operational summary for the schema-aligned backend.

## System Baseline

- repo: `textilebill-backend`
- API prefix: `/api`
- stack: NestJS 10, Prisma 5, PostgreSQL, Redis

## Runtime Rules

- do not auto-run migrations on app boot
- run DB jobs before app rollout
- keep bootstrap idempotent
- fail closed on readiness when schema/defaults are missing

## Core DB Workflow

```bash
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
```

## Current Domain Map

- SaaS: `Plan`, `Subscription`
- tenancy and identity: `Tenant`, `Company`, `User`, `UserCompany`, `RefreshToken`, `OtpChallenge`
- business masters: `Party`, `Account`, `Product`, `FinancialYear`, `VoucherSequence`
- business transactions: `Invoice`, `InvoiceItem`, `LedgerEntry`, `StockMovement`

## Removed Legacy Persistence

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
- `AuditLog`
- `InvoicePayment`
- `InvoiceNumberConfig`
- old account-group, broker, category, brand, UOM, and book-specific transaction tables

## Readiness Contract

Expect:

- `GET /api/health` alive
- `GET /api/system/health` alive
- `GET /api/system/readiness` healthy only when schema and defaults are ready
- protected traffic blocked when readiness fails

## Security and Observability

- global validation pipe
- sanitized exception filter
- request logging with response timing
- idempotency interceptor
- auth endpoint throttling
- Swagger gated by environment/config

## Verification Commands

```bash
npx prisma validate --schema prisma/schema.prisma
npx tsc --noEmit
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Current Verification Snapshot

Validated on `2026-03-30`:

- backend unit/integration: `57/57` suites, `252/252` tests
- backend e2e: `11` suites passed, `1` skipped

## Source Docs

- `database-schema.md`
- `database-operations.md`
- `data-validation.md`
- `test-scenarios.md`
- `API_CONTRACT.md`
