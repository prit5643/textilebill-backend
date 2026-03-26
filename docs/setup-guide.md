# Setup Guide (Supabase + Redis)

This guide is the source of truth for local setup with Supabase as the database.

## 1) Install dependencies

```bash
cd textilebill-backend
npm install

cd ../textilebill-frontend
npm install
```

## 2) Configure backend environment

Copy env template and update DB values:

```bash
cd textilebill-backend
cp .env.example .env
```

Set these required values in `.env`:

```bash
NODE_ENV=development
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY=1

# Supabase pooled URL (runtime, port 6543)
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1

# Supabase direct URL (migrations/bootstrap, port 5432)
DATABASE_DIRECT_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require

JWT_SECRET=<long-random-secret>
JWT_REFRESH_SECRET=<long-random-secret>
APP_SECRET_KEY=<long-random-secret>
```

Notes:
- Keep `APP_SECRET_KEY`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` different.
- Use pooled URL for runtime and direct URL for Prisma migration commands.

## 3) Bootstrap admin + defaults (first-time setup only)

If no `SUPER_ADMIN` exists yet, set:

```bash
BOOTSTRAP_ADMIN_EMAIL=<admin-email>
BOOTSTRAP_ADMIN_USERNAME=<admin-username>
BOOTSTRAP_ADMIN_PASSWORD=<strong-password>
```

## 4) Apply schema and seed data

```bash
cd textilebill-backend
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
```

## 5) Start services

Backend + Redis via Docker:

```bash
cd textilebill-backend
docker compose up --build -d
docker compose logs -f api
```

Frontend (new terminal):

```bash
cd textilebill-frontend
npm run dev
```

## 6) Quick verification

1. Backend docs: `http://localhost:3001/api/docs`
2. Health check: `http://localhost:3001/api/system/health`
3. Frontend login works with seeded admin user
