# User DB Relations, Operations, and DBA Analysis Guide

This is the DBA-oriented reference for:

1. How the database is structured and how write flows happen.
2. Which data is added, when it is added, and by which process.
3. Full index inventory (Prisma + migration-added indexes).
4. Current performance state, bottlenecks, and improvement roadmap.
5. Safe migration workflow to prevent schema drift.

Source of truth:
- `prisma/schema.prisma`
- `prisma/migrations/*/migration.sql`
- bootstrap/seed scripts under `prisma/seed.ts` and `scripts/`

Last updated: 2026-03-28

---

## 1) How the DB Works (Operational Model)

### 1.1 Tenancy and ownership boundaries

- `Tenant` is the top isolation boundary.
- `Company` belongs to one `Tenant`.
- User access is many-to-many via `UserCompanyAccess`.
- Most transactional rows are company-scoped (`companyId`).

### 1.2 Data domains

- SaaS domain: `Plan`, `Tenant`, `Subscription`
- Identity/Auth domain: `User`, `RefreshToken`, `OtpChallenge`, `PasswordLifecycleToken`
- Company config domain: `Company`, `CompanySettings`, `FinancialYear`
- Transactional business domain: `Invoice`, `InvoiceItem`, `InvoicePayment`, `LedgerEntry`, stock tables
- Governance domain: `ModulePermission`, `AuditLog`

### 1.3 Write behavior by workload

- Low-write, high-read: masters/config (`Plan`, `AccountGroup`, `ModulePermission`, `CompanySettings`)
- Medium-write: auth/session tables (`RefreshToken`, `OtpChallenge`, `PasswordLifecycleToken`)
- High-write and growth-critical: `Invoice`, `InvoiceItem`, `LedgerEntry`, `StockMovement`, `AuditLog`

### 1.4 Transaction and integrity characteristics

- Invoice creation in seed flow is transactional (`Invoice` + delete/recreate `InvoiceItem`).
- Most main relations are FK-constrained, but some integrity gaps still exist (see Section 9).
- PKs are UUID text IDs; every table has a PK btree index implicitly.

---

## 2) User Domain Relationship Map

Core identity path:

```text
Tenant (1) -> (many) User
User (1) -> (many) RefreshToken
User (1) -> (many) PasswordLifecycleToken
User (1) -> (many) OtpChallenge
User (many) <-> (many) Company via UserCompanyAccess
Company (1) -> (1) CompanySettings
```

SaaS access path:

```text
Tenant (1) -> (many) Subscription
Subscription (many) -> (1) Plan
```

Business data path:

```text
Company (1) -> (many) Product
Company (1) -> (many) Account
Company (1) -> (many) Invoice
Invoice (1) -> (many) InvoiceItem -> Product
Invoice (1) -> (many) InvoicePayment
Company (1) -> (many) StockMovement -> Product
Company (1) -> (many) LedgerEntry -> Account
Company (1) -> (many) CashBookEntry / BankBookEntry
Company (1) -> (many) JournalEntry -> JournalEntryLine -> Account [FK MISSING]
Company (1) -> (many) VoucherSequence -> FinancialYear
```

---

## 3) When Data Gets Added (Lifecycle and Timing)

This section answers: "when and what data is added?"

### 3.1 Schema-level timeline (from migration folders)

- 2026-03-05 12:10:32: `init`
- 2026-03-05 12:53:41: `add_max_companies`
- 2026-03-08 00:00:00: `ledger_partition`
- 2026-03-11 17:40:00: `add_user_avatar`
- 2026-03-11 19:25:00: `add_product_version`
- 2026-03-12 11:30:00: `add_invoice_payment_statuses`
- 2026-03-12 21:15:00: `production_query_index_review`
- 2026-03-13 09:00:00: `voucher_sequence_financial_year`
- 2026-03-17 12:00:00: `add_otp_challenge_and_contact_verification`
- 2026-03-17 13:00:00: `add_invite_token_to_user`
- 2026-03-18 18:30:00: `add_password_lifecycle_tokens`
- 2026-03-18 19:00:00: `add_invoice_unique_constraint`
- 2026-03-18 19:40:00: `add_refresh_token_session_metadata`
- 2026-03-19 12:15:00: `dba_hardening`

### 3.2 Bootstrap and seed data timing

- During `npm run db:bootstrap` (`prisma/seed.ts`):
  - Ensures required `AccountGroup` rows.
  - Ensures one `SUPER_ADMIN` (creates tenant/company/FY/settings if missing).
  - Creates `UserCompanyAccess` for super admin.
  - Optionally adds demo transactional data (`BOOTSTRAP_DEMO_TRANSACTION_DATA=true` or non-production default).

- During `scripts/bootstrap-demo-users.js`:
  - Upserts demo plan, tenant, subscription, company, FY.
  - Upserts admin/staff users and access mappings.

- During `scripts/bootstrap-auth-live-demo.js`:
  - Upserts one tenant, active subscription, two companies.
  - Upserts super admin + tenant admin + staff users.
  - Upserts one product and one account per company.

### 3.3 Runtime data-add points

- Login/refresh flow adds `RefreshToken` rows.
- OTP workflows add `OtpChallenge` rows.
- Password setup/reset adds `PasswordLifecycleToken` rows.
- Invoice transactions add `Invoice`, `InvoiceItem`, and related accounting/inventory rows depending on business flow.
- Audited actions add `AuditLog` rows.

### 3.4 Emergency/ops data actions

- `scripts/cleanup-superadmin-only.js`:
  - Truncates non-essential tables.
  - Keeps only one super admin user, associated tenant, and required account groups.
  - Intended for recovery/minimal baseline state only.

---

## 4) Minimum Data Needed for Readiness/Login

Minimum safe baseline:

1. One active `SUPER_ADMIN` user.
2. User belongs to an active `Tenant`.
3. Required `AccountGroup` rows exist:
   - `Cash-in-Hand`
   - `Bank Accounts`
   - `Sundry Debtors`
   - `Sundry Creditors`
4. Migration `20260311192500_add_product_version` is applied (`Product.version` exists).

If these are missing, readiness can fail with migration-required behavior.

---

## 5) Complete Index Inventory (Current)

Notes:
- PK indexes are implicit for every `@id`.
- Unique constraints create unique indexes.
- Inventory below includes Prisma schema indexes and migration-added indexes.

### 5.1 SaaS and identity

| Table | Unique indexes | Non-unique indexes |
|---|---|---|
| `Plan` | `name` | - |
| `Tenant` | `slug` | `slug` |
| `Subscription` | - | `(tenantId,status)`, `(endDate)`, `(tenantId,endDate,status)`, partial `(tenantId,endDate,status) WHERE status='ACTIVE'` |
| `User` | `email`, `username`, `inviteToken` | `(tenantId)`, `(email)`, `(username)` |
| `PasswordLifecycleToken` | `tokenHash` | `(userId,type,status)`, `(tenantId,status,expiresAt)`, `(expiresAt)`, `(createdAt)` |
| `RefreshToken` | `token`, `tokenHash` | `(token)`, `(tokenHash)`, `(userId)`, `(userId,revokedAt,expiresAt)`, `(expiresAt)` |
| `OtpChallenge` | - | `(userId,purpose,verifiedAt)`, `(expiresAt)` |

### 5.2 Company and access

| Table | Unique indexes | Non-unique indexes |
|---|---|---|
| `Company` | - | `(tenantId)` |
| `UserCompanyAccess` | `(userId,companyId)` | `(userId)`, `(companyId)`, `(companyId,userId)` |
| `FinancialYear` | `(companyId,name)` | `(companyId)`, `(companyId,isActive)`, partial `(companyId,isActive) WHERE isActive=true` |
| `CompanySettings` | `companyId` | - |

### 5.3 Product and account masters

| Table | Unique indexes | Non-unique indexes |
|---|---|---|
| `ProductCategory` | `(companyId,name)` | - |
| `Brand` | `(companyId,name)` | - |
| `UnitOfMeasurement` | `name` | - |
| `Product` | - | `(companyId)`, `(name)`, `(hsnCode)`, `(searchCode)` |
| `AccountGroup` | `name` | - |
| `Broker` | - | `(companyId)` |
| `Account` | - | `(companyId)`, `(companyId,name)`, `(name)`, `(gstin)`, `(groupId)` |

### 5.4 Invoice, accounting, inventory, audit

| Table | Unique indexes | Non-unique indexes |
|---|---|---|
| `InvoiceNumberConfig` | `(companyId,invoiceType)` | - |
| `Invoice` | `(companyId,invoiceType,invoiceNumber)` | `(companyId)`, `(accountId)`, `(invoiceType)`, `(invoiceDate)`, `(invoiceNumber)`, `(status)`, `(companyId,invoiceType,invoiceDate)`, `(companyId,accountId,invoiceDate)`, `(companyId,invoiceType,status,invoiceDate)` |
| `InvoiceItem` | - | `(invoiceId)`, `(productId)` |
| `InvoicePayment` | - | `(invoiceId)` |
| `VoucherSequence` | `(companyId,financialYearId,series)` | `(companyId,financialYearId)` |
| `LedgerEntry` | - | `(companyId)`, `(accountId)`, `(date)`, `(voucherType)`, `(companyId,date)`, `(companyId,accountId,date)`, `(companyId,voucherType,voucherNumber)` |
| `CashBookEntry` | - | `(companyId)`, `(date)`, `(bookName)`, `(companyId,date)`, `(companyId,bookName,date)` |
| `BankBookEntry` | - | `(companyId)`, `(date)`, `(bookName)`, `(companyId,date)`, `(companyId,bookName,date)` |
| `JournalEntry` | - | `(companyId)`, `(date)`, `(companyId,date)` |
| `JournalEntryLine` | - | `(journalEntryId)` |
| `StockMovement` | - | `(companyId)`, `(productId)`, `(date)`, `(companyId,productId,date)` |
| `OpeningStock` | - | `(companyId)`, `(productId)`, `(companyId,createdAt)` |
| `StockAdjustment` | - | `(companyId)`, `(companyId,date)` |
| `ModulePermission` | `(companyId,role,module)` | `(companyId)` |
| `AuditLog` | - | `(companyId)`, `(userId)`, `(entity)`, `(createdAt)`, `(tenantId,createdAt)`, `(companyId,entity,createdAt)`, `(entityId,entity)` |

---

## 6) Performance State (Current Assessment)

### 6.1 Strengths

- Multi-column indexes exist for key query patterns in `Invoice`, `LedgerEntry`, and book tables.
- Auth/session expiry and lookup coverage exists (`RefreshToken`, `PasswordLifecycleToken`).
- Audit filtering has tenant/company/date-aware indexes from DBA hardening.

### 6.2 Risks and inefficiencies

- Redundant indexes increase write cost and vacuum overhead:
  - `Tenant.slug` unique + extra index
  - `UserCompanyAccess` overlapping indexes around unique `(userId,companyId)`
  - `RefreshToken` unique + duplicated non-unique indexes on `token` and `tokenHash`
- Missing FK constraints in some tables can produce orphan rows and inaccurate cardinality estimates.
- History-risking cascade remains on `InvoiceItem.product`.
- `AccountGroup.name` is globally unique (cross-company scaling limitation).

### 6.3 Growth hotspots to monitor first

- `Invoice`, `InvoiceItem`, `LedgerEntry`, `AuditLog`, `RefreshToken`, `OtpChallenge`.
- For each hotspot, track tuple growth, dead tuples, index usage, and plan drift.

---

## 7) DBA Query Pack (Health + Optimization)

### 7.1 Live index inventory (authoritative in DB)

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### 7.2 Table size, index size, total footprint

```sql
SELECT
  relname AS table_name,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS index_size,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

### 7.3 Index usage and possible dead indexes

```sql
SELECT
  s.schemaname,
  s.relname AS table_name,
  s.indexrelname AS index_name,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
FROM pg_stat_user_indexes s
ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;
```

### 7.4 Seq-scan heavy tables

```sql
SELECT
  relname AS table_name,
  seq_scan,
  idx_scan,
  n_live_tup,
  CASE
    WHEN (seq_scan + idx_scan) = 0 THEN 0
    ELSE ROUND((seq_scan::numeric / (seq_scan + idx_scan)) * 100, 2)
  END AS seq_scan_pct
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;
```

### 7.5 Dead tuples / autovacuum pressure

```sql
SELECT
  relname AS table_name,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

### 7.6 Long-running transactions (lock risk)

```sql
SELECT
  pid,
  usename,
  state,
  now() - xact_start AS txn_age,
  query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY txn_age DESC;
```

### 7.7 Top statements (requires pg_stat_statements)

```sql
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 50;
```

---

## 8) Readiness and Post-Deploy Verification

Run these checks after migration deploy:

```sql
-- SUPER_ADMIN and tenant link
SELECT u.id, u.email, u.role, u."isActive", t.id AS tenant_id, t."isActive" AS tenant_active
FROM "User" u
JOIN "Tenant" t ON t.id = u."tenantId"
WHERE u.role = 'SUPER_ADMIN';

-- Required account groups
SELECT name
FROM "AccountGroup"
WHERE name IN ('Cash-in-Hand','Bank Accounts','Sundry Debtors','Sundry Creditors');

-- RefreshToken columns
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'RefreshToken'
ORDER BY ordinal_position;

-- Known orphan checks for currently unconstrained paths
SELECT COUNT(*) AS orphan_stock_adjustment_product
FROM "StockAdjustment" sa
LEFT JOIN "Product" p ON sa."productId" = p.id
WHERE p.id IS NULL;

SELECT COUNT(*) AS orphan_opening_stock_company
FROM "OpeningStock" os
LEFT JOIN "Company" c ON os."companyId" = c.id
WHERE c.id IS NULL;
```

---

## 9) Known Schema Issues and Fixes (DBA Priority)

### P1: Critical

| # | Model | Issue | Fix |
|---|---|---|---|
| 1 | `InvoiceItem` | `product` is `onDelete: Cascade`, can erase history | Change to `onDelete: Restrict` |
| 2 | `StockMovement` | `product` relation lacks explicit restrictive delete rule | Add `onDelete: Restrict` |
| 3 | `OpeningStock` | Missing FK to `Company` | Add FK relation + back relation |
| 4 | `StockAdjustment` | Missing FK to `Company` and `Product` | Add both FK relations |
| 5 | `JournalEntryLine` | Missing FK for `accountId` | Add `Account` relation + index |

### P2: Important

| # | Model | Issue | Fix |
|---|---|---|---|
| 6 | `CashBookEntry` | `invoiceId` has no FK | Add optional `Invoice` relation |
| 7 | `BankBookEntry` | `invoiceId` has no FK | Add optional `Invoice` relation |
| 8 | `ModulePermission` | `companyId` no FK | Add `Company` relation |
| 9 | `AuditLog` | `tenantId` no FK | Add optional `Tenant` relation |
| 10 | `RefreshToken` | legacy cleartext `token` still present | migrate to `tokenHash`-only and drop `token` |
| 11 | `Broker` | no `tenantId` direct scope | consider adding `tenantId` |

### P3: Optimization

| # | Location | Issue | Fix |
|---|---|---|---|
| 12 | `UserCompanyAccess` | overlapping indexes with unique key | keep only needed index(es) |
| 13 | `Tenant` | `slug` indexed twice (unique + plain index) | remove redundant plain index |
| 14 | `RefreshToken` | non-unique indexes on unique columns | remove redundant plain indexes |

### Breaking-modeling change

| # | Model | Issue | Fix |
|---|---|---|---|
| 15 | `AccountGroup` | global unique `name` limits multi-company defaults | add `companyId` + scoped unique |

---

## 10) Migration Workflow (Simple and Safe)

Standard flow:

1. Update `prisma/schema.prisma`.
2. Generate migration in dev:
   - `npx prisma migrate dev --name <change_name>`
3. Validate SQL content in generated `migration.sql`.
4. Commit both schema and migration.
5. Deploy migrations in production:
   - `npm run db:migrate:deploy`
6. Run readiness + SQL verification queries (Section 8).
7. Run application smoke checks (auth + one business transaction).

Rules:

- Do not run manual production `ALTER TABLE` except emergency recovery.
- If emergency SQL is used, create follow-up Prisma migration immediately.
- Avoid `onDelete: Cascade` on business-history rows (`InvoiceItem`, `StockMovement`, `LedgerEntry`).

---

## 11) DBA Improvement Backlog (Execution Order)

1. Fix referential integrity P1 items.
2. Remove redundant indexes and recheck write amplification.
3. Drop legacy `RefreshToken.token` after full session rotation.
4. Introduce FK-safe invoice links in book tables.
5. Re-evaluate `AccountGroup` uniqueness model for multi-tenant scaling.
6. Establish monthly index-usage review and dead-tuple review cadence.

Suggested cadence:

- Daily: error logs + readiness + long transaction check.
- Weekly: table growth, index usage, dead tuple trend.
- Monthly: index pruning, analyze query plans for top 20 statements.
