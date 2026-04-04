# Database Operations Guide

Last updated: `2026-03-30`

## Principles

- runtime app instances must not auto-run migrations
- schema changes are applied explicitly
- bootstrap must be idempotent
- runtime and maintenance DB URLs should be separated

## Commands

```bash
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
npm run db:setup
```

## Connection URLs

- `DATABASE_URL`
  - runtime traffic, typically pooled
- `DATABASE_DIRECT_URL`
  - direct connection for migrations and bootstrap
- `DATABASE_ADMIN_URL`
  - optional admin connection used by `db:init`

## What Each Command Does

### `db:init`

- ensures the target DB exists
- does not mutate existing schema or business data

### `db:migrate:deploy`

- applies checked-in Prisma migrations
- is safe to rerun when already up to date

### `db:bootstrap`

- runs `prisma/seed.ts`
- creates only missing baseline records
- ensures:
  - bootstrap tenant/company
  - owner user and `UserCompany` role mapping
  - current financial year
  - voucher sequences
  - base product/account demo data when enabled

### `db:setup`

- runs init + migrate + bootstrap

## Deployment Order

1. `npm run db:init`
2. `npm run db:migrate:deploy`
3. `npm run db:bootstrap`
4. start or roll application instances

## Readiness Expectations

The app should be considered ready only when:

- current schema tables exist
- baseline bootstrap data exists
- `/api/system/readiness` returns healthy

## Recovery Notes

After restore or emergency DB changes, verify:

- `npx prisma validate --schema prisma/schema.prisma`
- `GET /api/system/readiness`
- login flow
- invoice creation
- payment posting
