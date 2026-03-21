# Backend Operations Handbook

Last updated: 2026-03-17

This is the one-file backend operations guide for day-to-day engineering and production readiness.
It consolidates database operations, schema rules, validation behavior, security/observability controls, and test scenarios.

## 1. System Baseline

- Backend stack: NestJS 10, TypeScript, Prisma 5, PostgreSQL 16, Redis 7
- Repo path: textilebill-backend
- API prefix assumed in examples: /api

## 2. Critical Startup and Runtime Principles

- App runtime must not auto-run schema migrations.
- Migrations are deployment-time operations, not app boot operations.
- Bootstrap must be idempotent and create-missing-only.
- Readiness gate must fail closed when required schema/defaults are missing.
- Client responses must remain sanitized; internal errors stay in server logs.

## 3. Database Operations

Run from textilebill-backend.

```bash
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
npm run db:setup
```

### 3.1 Command Responsibilities

- db:init
  - Ensures target PostgreSQL database exists.
  - Does not mutate schema/data in existing DB.
- db:migrate:deploy
  - Applies checked-in Prisma migrations.
  - Safe no-op when up to date.
- db:bootstrap
  - Creates only missing baseline records.
  - Uses advisory lock to avoid duplicate concurrent bootstrap.
- db:setup
  - Runs init + migrate + bootstrap flow.

### 3.2 Idempotency Matrix

- db:init: idempotent
- db:migrate:deploy: idempotent
- db:bootstrap: idempotent for existing records

## 4. Database Connection Model

Use separate URLs for runtime vs maintenance tasks.

- DATABASE_URL
  - Runtime app traffic (typically via PgBouncer in scaled deployments)
- DATABASE_DIRECT_URL
  - Direct PostgreSQL for migration/bootstrap jobs
- DATABASE_ADMIN_URL (optional)
  - Admin DB connection for db:init create-if-missing flow

### Deployment order (multi-server)

1. Run once per release: db:init, db:migrate:deploy, db:bootstrap
2. Then roll/start app instances

## 5. Schema Ownership Rules

Primary schema file: prisma/schema.prisma

### Domain map

- SaaS: Plan, Tenant, Subscription
- Identity: User, RefreshToken, UserCompanyAccess
- Company: Company, CompanySettings, FinancialYear
- Product/inventory: Product, ProductCategory, Brand, UnitOfMeasurement, StockMovement, OpeningStock, StockAdjustment
- Accounting: AccountGroup, Account, Broker, LedgerEntry, CashBookEntry, BankBookEntry, JournalEntry, JournalEntryLine
- Invoice/payments: InvoiceNumberConfig, Invoice, InvoiceItem, InvoicePayment
- Security/audit: ModulePermission, AuditLog

### Migration policy

- Schema changes must go through Prisma migrations.
- Avoid manual production schema edits.
- If emergency SQL is applied, backfill with tracked migration to realign environments.

### Safe new-field workflow

1. Update prisma/schema.prisma
2. Create migration in dev
3. Commit migration SQL
4. Deploy via db:migrate:deploy
5. Update seed/bootstrap only if baseline data is needed

## 6. Readiness Contract

Readiness checks validate required schema objects and baseline records.

Expected behavior:

- Health endpoint remains available.
- Readiness endpoint returns 200 when ready, 503 when not ready.
- Protected traffic is blocked when readiness fails.
- Backend logs exact cause; frontend receives sanitized message.

Endpoints:

- GET /api/system/health
- GET /api/system/readiness

## 7. Validation and Error Handling

### Global request validation

Configured in main.ts via ValidationPipe with:

- whitelist: true
- forbidNonWhitelisted: true
- transform: true
- enableImplicitConversion: true

Effects:

- Unknown fields rejected.
- DTO validation enforced.
- Primitive conversion applied where possible.

### Error sanitization

Global exception filter sanitizes user-facing errors and keeps technical detail in logs.

### Business validation examples

- Invoice requires company GSTIN.
- Cancelled invoice update prevention.
- Concurrency protection via Product.version.
- Subscription guard for non-super-admin users.
- Roles guard for permission boundaries.

## 8. Security and Observability Controls

### 8.1 Secret exposure controls

- OTP values are never logged.
- User/tenant create responses do not include temporary passwords.
- Tenant provisioning requires explicit adminPassword input.

### 8.2 Auth abuse throttling

Rate limits are applied for:

- POST /api/auth/login
- POST /api/auth/forgot-password
- POST /api/auth/reset-password

Config keys:

- AUTH_LOGIN_RATE_LIMIT_MAX
- AUTH_LOGIN_RATE_LIMIT_WINDOW_MS
- AUTH_FORGOT_RATE_LIMIT_MAX
- AUTH_FORGOT_RATE_LIMIT_WINDOW_MS
- AUTH_RESET_RATE_LIMIT_MAX
- AUTH_RESET_RATE_LIMIT_WINDOW_MS

### 8.3 Request observability

Log context includes normalized path, route template, status, duration, request/company/user context.

Response header:

- x-response-time-ms

Slow request warning threshold:

- SLOW_REQUEST_MS

### 8.4 Swagger production policy

- Enabled by default outside production.
- Disabled by default in production.
- Can be enabled in production with ENABLE_SWAGGER=true.

## 9. High-Value Test Scenarios

## 9.1 Baseline setup

```bash
npm run db:setup
npm run start:dev
```

### 9.2 Scenario coverage checklist

- Readiness gate correctness (health/readiness/protected behavior)
- Bootstrap idempotency (no duplicate baseline records)
- Invoice happy path (invoice/items/stock/ledger effects)
- Invoice validation failure paths (GSTIN missing, numbering validation, payload validation, concurrency conflict)
- Authorization boundaries (roles/subscription/deactivated users)
- Accounting prerequisites (required account groups)
- Voucher sequence determinism + ledger carry-forward correctness
- Auth abuse throttling + secret handling
- Lightweight selector/header payload views for hot endpoints

Failure criteria:

- Raw Prisma/DB internals leak to client
- Known business conditions return generic 500
- Bootstrap duplicates/overwrites baseline data

## 10. Operations Runbook Shortcuts

### Release-time DB workflow

```bash
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
```

### Focused security/observability tests

```bash
npm test -- src/common/utils/config-value.util.spec.ts src/common/interceptors/logging.interceptor.spec.ts src/modules/auth/auth-rate-limit.util.spec.ts src/modules/auth/auth-rate-limit.integration.spec.ts src/modules/auth/auth.service.spec.ts src/modules/users/users.service.spec.ts src/modules/admin/admin.service.spec.ts
npm run test:e2e -- test/auth-rate-limit.e2e-spec.ts test/auth.e2e-spec.ts
```

## 11. Backup And Recovery Governance

- `RPO`: 15 minutes target
- `RTO`: 60 minutes target
- Drill frequency: monthly mandatory restore drill
- Ownership: backend/SRE on-call

### 11.1 Mandatory monthly drill evidence

- backup artifact id used
- restore start/end timestamps
- achieved RPO/RTO values
- readiness + critical flow verification output
- open remediation actions with owner and ETA

### 11.2 Recovery verification minimums

- `/api/system/readiness` returns healthy
- auth login + refresh flow works
- invoice create path works
- payment posting path works
- latest migration state is consistent

## 12. Source Documents (Detailed)

- database-operations.md
- database-schema.md
- data-validation.md
- security-observability.md
- test-scenarios.md
- code-navigation.md
- regression-playbook.md
- features.md
