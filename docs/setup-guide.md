# Setup Guide

Last updated: `2026-03-30`

This is the schema-aligned setup guide for running backend and frontend locally.

## 1. Install Dependencies

```bash
cd textilebill-backend
npm install

cd ../textilebill-frontend
npm install
```

## 2. Configure Backend

```bash
cd textilebill-backend
cp .env.example .env
```

Required backend values:

```env
NODE_ENV=development
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

DATABASE_URL=<runtime-db-url>
DATABASE_DIRECT_URL=<direct-db-url>

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
APP_SECRET_KEY=<secret>

BOOTSTRAP_ADMIN_EMAIL=owner@example.com
BOOTSTRAP_ADMIN_NAME=System Owner
BOOTSTRAP_ADMIN_PASSWORD=ChangeMe@123
```

## 3. Configure Frontend

```bash
cd ../textilebill-frontend
cp .env.example .env.local
```

Minimum frontend values:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
JWT_SECRET=<same secret used for frontend session-token verification>
```

## 4. Prepare Database

```bash
cd ../textilebill-backend
npm run db:setup
```

## 5. Start Services

Backend:

```bash
cd textilebill-backend
npm run start:dev
```

Frontend:

```bash
cd textilebill-frontend
npm run dev
```

## 6. Verify

- backend docs: `http://localhost:3001/api/docs`
- backend readiness: `http://localhost:3001/api/system/readiness`
- frontend login: `http://localhost:3000/login`

## 7. Test

Backend:

```bash
npx prisma validate --schema prisma/schema.prisma
npx tsc --noEmit
npm test -- --runInBand
```

Frontend:

```bash
npm run build
npm test -- --runInBand
```
