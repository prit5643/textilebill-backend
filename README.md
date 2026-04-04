# TextileBill Backend

NestJS 10 + Prisma 5 backend for the TextileBill multi-tenant ERP platform.

## Current Status

- Prisma schema source of truth: `prisma/schema.prisma`
- Runtime database model is aligned to the new schema as of `2026-03-30`
- Verified locally:
  - `npx prisma validate --schema prisma/schema.prisma`
  - `npx tsc --noEmit`
  - `npm run build`
  - `npm test -- --runInBand`
  - `npm run test:e2e -- --runInBand`

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run start:dev
```

Backend URL: `http://localhost:3001`  
Swagger: `http://localhost:3001/api/docs`

## Important Runtime Notes

- Runtime must not auto-run Prisma migrations.
- Apply DB changes with `npm run db:migrate:deploy`.
- Seed/bootstrap is idempotent and runs through `npm run db:bootstrap`.
- Redis is optional for local development but recommended for realistic auth, rate-limit, and idempotency behavior.

## Main Commands

```bash
# local setup
npm run db:setup

# start API
npm run start:dev

# compile/build
npx tsc --noEmit
npm run build

# tests
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Documentation

- `docs/README.md`
- `docs/API_CONTRACT.md`
- `docs/database-schema.md`
- `docs/authentication-flows.md`
- `docs/setup-guide.md`
- `docs/database-operations.md`
- `docs/backend-operations-handbook.md`
