# TextileBill App Workflow and Behavior Guide

This is a single, end-to-end document that explains:

1. What the app does.
2. How it works across frontend, backend, and database.
3. When each major process runs.

---

## 1) What the App Does

TextileBill is a multi-tenant SaaS system for textile business operations.

Core outcomes:
- Manage tenants, companies, users, and role-based access.
- Maintain master data (products, accounts, brokers, groups).
- Create and manage invoices with tax calculations.
- Record payments and keep accounting books in sync.
- Track inventory movements and stock adjustments.
- Provide reporting and auditability.

---

## 2) System Components and Their Roles

### Frontend (Next.js)
- Provides login, dashboard, data entry, and reporting screens.
- Stores user session state and active company context.
- Calls backend APIs over HTTP.

### Backend (NestJS)
- Exposes all APIs under `/api` (with alias handling for `/api/v1` in runtime bootstrap).
- Validates input, enforces auth and authorization, and applies rate limiting.
- Executes business logic for billing, accounting, stock, and admin operations.
- Writes audit logs and standardizes API responses.

### Database (PostgreSQL via Prisma)
- Persists all tenant/company/user/business data.
- Enforces most key constraints and indexes.
- Stores migration history in `_prisma_migrations`.

### Redis
- Used for rate limiting and idempotency support.
- Helps prevent duplicate write operations and abuse bursts.

---

## 3) What Happens at Application Startup

When backend starts (`src/main.ts`), this sequence runs:

1. Boot Nest app and load config values.
2. Set global API prefix and trusted proxy behavior.
3. Build URL alias routing (`/api` <-> `/api/v1` when configured).
4. Ensure uploads directory exists.
5. Apply security middleware (`helmet`) and CORS policy.
6. Register auth and write rate limiters.
7. Register global validation pipe (whitelist + transform + forbid unknown fields).
8. Register global filters/interceptors:
   - exception sanitization
   - request logging and slow-request metrics
   - idempotency
   - audit logging
   - response transformation
9. Conditionally expose Swagger based on environment/settings.
10. Start HTTP server.

When this happens:
- Every backend restart or new deployment start.

---

## 4) Runtime Request Lifecycle (How One API Call Works)

For a typical request:

1. Request enters API route.
2. Rate limiter evaluates request path and client context.
3. Validation pipe validates and transforms payload.
4. Auth guard verifies JWT (for protected routes).
5. Authorization checks role and access scope.
6. Idempotency interceptor checks duplicate write requests.
7. Module service executes business logic.
8. Prisma reads/writes database.
9. Audit interceptor records activity metadata.
10. Transform interceptor formats final response.

When this happens:
- On every API request.

---

## 5) Authentication and Access Behavior

### Login
- User submits credentials.
- Backend validates user, status, tenant/subscription constraints, and password.
- On success, session/access tokens are issued and refresh state is stored.
- `RefreshToken` rows are created/updated.

When it happens:
- On user login attempts.

### Token Refresh
- Expiring/expired access token triggers refresh flow.
- Backend validates refresh token metadata/hash and expiry.
- New access token is issued and session usage metadata is updated.

When it happens:
- During active sessions when access token rotation is needed.

### Logout
- Session refresh token is revoked/invalidated.

When it happens:
- On explicit logout or forced session invalidation.

### Password Reset/Setup + OTP
- Password lifecycle tokens and OTP challenge rows are generated and verified as required.

When it happens:
- During forgot-password, setup-password, and verification workflows.

---

## 6) Business Workflow Behavior (Invoice to Accounts/Stock)

### Master setup phase
- Company, financial year, account groups, accounts, products are prepared first.

When it happens:
- During onboarding, bootstrap, or normal setup operations.

### Invoice transaction phase
- User creates/updates invoice.
- Item lines are validated and totals/taxes computed.
- Invoice and invoice items are written.
- Payment state is tracked (`InvoicePayment` where applicable).
- Related ledger/stock effects are applied according to invoice type and settings.

When it happens:
- Every invoice create/edit/cancel operation.

### Accounting books phase
- Cash book / bank book / journal / ledger entries are created from accounting operations.
- Voucher sequencing ensures deterministic voucher numbering per company + FY + series.

When it happens:
- Whenever accounting-impacting transactions are posted.

### Reporting phase
- Aggregations are served from invoice/accounting/stock tables.

When it happens:
- On dashboard/report page loads and report API calls.

---

## 7) Data Added Timeline (When Data Is Introduced)

### A) Schema data structures
- Added only via Prisma migrations (`prisma/migrations/*`).

When it happens:
- On deployment or explicit migration execution.

### B) Baseline operational data
- Added by bootstrap/seed scripts:
  - required account groups
  - super admin and tenant/company linkage
  - financial year and company settings baseline

When it happens:
- During `db:bootstrap` or explicit seed execution.

### C) Demo/staging data
- Added by demo bootstrap scripts (optional).

When it happens:
- During explicit demo bootstrap script runs.

### D) Live transactional data
- Added continuously by users via APIs.

When it happens:
- During normal production usage.

---

## 8) Platform Reliability Behavior

### Readiness and liveness
- Health endpoints expose process/database readiness status.
- Deployment checks depend on expected schema/data prerequisites.

When it happens:
- During load balancer health checks and post-deploy validation.

### Rate limiting and abuse control
- Sensitive auth/write routes are throttled.

When it happens:
- On matching route traffic.

### Request observability
- Request IDs, response-time headers, and slow-request paths are logged.

When it happens:
- On every request.

### Audit logging
- Business/security-sensitive actions are written to `AuditLog`.

When it happens:
- On audited operations through interceptor path.

---

## 9) Daily Operational Mental Model (Simple)

1. App starts, security/validation/interceptors activate.
2. User authenticates and receives session context.
3. User selects company context.
4. User performs master or transaction operations.
5. Backend validates + writes DB + logs audit.
6. Reports read from transaction tables.
7. Background ops are minimal; most work is request-driven.

---

## 10) Environment-Based Behavior

### Development
- Swagger usually enabled.
- Demo transactional seed can be enabled by default behavior in seed logic.

### Production
- Swagger controlled by env setting and typically disabled unless explicitly enabled.
- Strict readiness expectations and migration alignment required.
- Avoid manual schema edits; use migration pipeline.

---

## 11) Quick Answers

### What does the app do?
- Multi-tenant textile billing, accounting, inventory, user and access management with reporting.

### How does it work?
- Next.js UI -> NestJS APIs -> Prisma -> PostgreSQL, with Redis-assisted rate-limit/idempotency and global middleware/interceptor governance.

### When does it do things?
- Startup tasks on deploy/restart.
- Auth/session tasks on login/refresh/logout.
- Business writes on invoice/accounting/stock actions.
- Reporting on dashboard/report requests.
- Health checks continuously via readiness/liveness endpoints.

---

## 12) Source References

Primary runtime and docs references used for this guide:
- `src/main.ts`
- `docs/features.md`
- `README.md` (backend)
- `../textilebill-frontend/README.md`
- `prisma/schema.prisma`
- `prisma/seed.ts`
