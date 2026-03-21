# Database Operations Guide

## Goals

- The running app must **not** auto-run schema migrations.
- Schema changes are applied explicitly during deployment.
- Minimum required default data is bootstrapped separately and idempotently.
- Re-running operations must be safe.
- Runtime app connectivity should stay stable under multi-server traffic.

## Commands

From `textilebill-backend`:

```bash
# Create database if missing (PostgreSQL)
npm run db:init

# Apply Prisma schema migrations
npm run db:migrate:deploy

# Bootstrap minimum default data only (no schema changes)
npm run db:bootstrap

# End-to-end setup command
npm run db:setup
```

## Connection URLs (Recommended)

Use separate URLs for runtime traffic vs maintenance jobs:

- `DATABASE_URL`
  - App runtime URL (typically PgBouncer endpoint, e.g. port `6432`)
- `DATABASE_DIRECT_URL`
  - Direct Postgres URL for migration/bootstrap scripts
- `DATABASE_ADMIN_URL` (optional)
  - Direct admin DB URL used by `db:init` for create-if-missing

## What Each Command Does

### `db:init`

- File: `scripts/db-ensure.ts`
- Connects to admin DB (`DATABASE_ADMIN_URL` or `.../postgres`) and checks whether target DB exists.
- Uses `DATABASE_DIRECT_URL` (when present) as the source URL so it does not target a pooler endpoint.
- Creates target DB only if missing.
- Does not alter tables, columns, or data in existing DBs.

### `db:migrate:deploy`

- Runs checked-in Prisma SQL migrations from `prisma/migrations`.
- If already up to date, it is a no-op (`No pending migrations to apply`).
- Does not recreate existing objects already tracked by migrations.
- Prefers `DATABASE_DIRECT_URL` when present.

### `db:bootstrap`

- File: `prisma/seed.ts`
- Creates only missing required baseline records:
  - required account groups used by accounting/report flows
  - one `SUPER_ADMIN` (only if none exists)
  - tenant/company/settings/financial-year linkage for first-run
- Uses PostgreSQL advisory lock to prevent duplicate bootstrap on concurrent nodes.
- Does not update existing records.
- Prefers `DATABASE_DIRECT_URL` when present.

## Security Rules for First Admin

- No hardcoded fallback password is used.
- If no `SUPER_ADMIN` exists, these environment variables are mandatory:
  - `BOOTSTRAP_ADMIN_EMAIL`
  - `BOOTSTRAP_ADMIN_USERNAME`
  - `BOOTSTRAP_ADMIN_PASSWORD`
- If a `SUPER_ADMIN` already exists, bootstrap does not require those variables.

## Multi-Server / Load Balancer Deployment

Use this order:

1. Run database jobs once (CI/CD job or release job):
   - `npm run db:init`
   - `npm run db:migrate:deploy`
   - `npm run db:bootstrap`
2. Start/roll app pods/servers.

Why:

- Avoid multiple app instances trying to mutate schema.
- Keep rollout deterministic.
- Bootstrap lock protects against accidental concurrent bootstrap runs.

## PgBouncer Guidance For Scale

- Put PgBouncer between app servers and Postgres.
- Use transaction pooling mode.
- Keep app-side `connection_limit` low per instance (for example `3-10` based on workload).
- Use direct Postgres URL for migrations/bootstrap tasks.
- Tune PgBouncer pool sizes according to Postgres `max_connections` and expected concurrency.

## Idempotency Matrix

- `db:init`: idempotent
- `db:migrate:deploy`: idempotent
- `db:bootstrap`: idempotent for existing records (create-missing-only)

## Backup And Recovery Runbook

## Recovery Objectives

- `RPO` target: <= 15 minutes for production transactional data.
- `RTO` target: <= 60 minutes for full API recovery.
- Backup ownership: on-call backend/SRE rotation.

## Backup Cadence

- Full logical backup: daily (`pg_dump -Fc`).
- Incremental/WAL backup: every 5-15 minutes (environment dependent).
- Retention:
  - daily: 14 days
  - weekly: 8 weeks
  - monthly: 6 months

## Standard Backup Commands (Reference)

```bash
# Full backup
pg_dump "$DATABASE_DIRECT_URL" -Fc -f backup_$(date +%F_%H%M).dump

# Verify backup can be listed
pg_restore --list backup_YYYY-MM-DD_HHMM.dump | head
```

## Restore Drill Procedure (Monthly, Mandatory)

1. Create an isolated restore database (never restore over production first).
2. Restore latest full backup.
3. Apply WAL/incremental replay up to target timestamp.
4. Run smoke verification:
  - migration state check
  - readiness endpoint check
  - critical invoice/payment query checks
5. Record drill result in operations log:
  - start/end timestamps
  - achieved RPO/RTO
  - issues found and remediation owner

## Incident Recovery Checklist

1. Declare incident and assign recovery commander.
2. Freeze risky write operations if partial corruption is suspected.
3. Select restore point (`T-restore`) aligned with business approval.
4. Restore to staging clone and validate data integrity.
5. Promote restored database to production endpoint.
6. Run post-restore checks:
  - `/api/system/readiness`
  - auth login/refresh
  - invoice create + payment flow
7. Publish incident closure note including actual RPO/RTO.

## Readiness Contract

- App validates schema/data readiness and logs details in backend logs.
- Client receives sanitized `503` response (no internal schema details leaked).
- Health endpoints:
  - `GET /api/system/health`
  - `GET /api/system/readiness`
