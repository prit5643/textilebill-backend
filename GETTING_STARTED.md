# Getting Started - TextileBill Backend

This guide is aligned to the current Prisma schema and backend scripts.

## Prerequisites

- Node.js 20
- PostgreSQL or Supabase Postgres
- Redis

## 1. Install

```bash
npm install
```

## 2. Configure `.env`

```bash
cp .env.example .env
```

Minimum local values:

```env
NODE_ENV=development
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/textilebill
DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5432/textilebill

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET=<openssl rand -base64 32>
JWT_REFRESH_SECRET=<openssl rand -base64 32>
APP_SECRET_KEY=<openssl rand -base64 32>

BOOTSTRAP_ADMIN_EMAIL=owner@example.com
BOOTSTRAP_ADMIN_NAME=System Owner
BOOTSTRAP_ADMIN_PASSWORD=ChangeMe@123
```

Notes:

- Keep `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `APP_SECRET_KEY` different.
- For Supabase, use pooled `DATABASE_URL` for runtime and direct `DATABASE_DIRECT_URL` for migrations/bootstrap.

## 3. Prepare Database

```bash
npm run db:setup
```

This runs:

- `npm run db:init`
- `npm run db:migrate:deploy`
- `npm run db:bootstrap`

## 4. Start Redis

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

or use your local Redis service.

## 5. Start Backend

```bash
npm run start:dev
```

## 6. Verify

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/system/readiness
```

Open:

- `http://localhost:3001/api/docs`

## 7. Test

```bash
npx prisma validate --schema prisma/schema.prisma
npx tsc --noEmit
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Where To Read Next

- `docs/API_CONTRACT.md`
- `docs/database-schema.md`
- `docs/authentication-flows.md`
- `docs/setup-guide.md`
