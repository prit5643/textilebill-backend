# Setup Steps After Latest Changes

This file is the single source of truth for setting up the project after the recent security and DBA hardening updates.

## 1) Pull latest code

```bash
git pull origin codex/refactor-app
```

## 2) Install dependencies

```bash
cd textilebill-backend
npm install

cd ../textilebill-frontend
npm install
```

## 3) Configure backend environment

Create/update `textilebill-backend/.env` with at least:

```bash
NODE_ENV=development
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY=1

DATABASE_URL=postgresql://<user>:<password>@localhost:5432/textilebill
# Optional but recommended for migration/bootstrap jobs:
# DATABASE_DIRECT_URL=postgresql://<user>:<password>@localhost:5432/textilebill

JWT_SECRET=<long-random-secret>
JWT_REFRESH_SECRET=<long-random-secret>
APP_SECRET_KEY=<long-random-secret>
```

Notes:
- `APP_SECRET_KEY` is now used for encrypting sensitive company settings values.
- Keep `APP_SECRET_KEY`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` different.

## 4) Bootstrap admin + defaults (first-time setup only)

If no `SUPER_ADMIN` exists yet, set:

```bash
BOOTSTRAP_ADMIN_EMAIL=<admin-email>
BOOTSTRAP_ADMIN_USERNAME=<admin-username>
BOOTSTRAP_ADMIN_PASSWORD=<strong-password>
```

Optional bootstrap values:

```bash
BOOTSTRAP_TENANT_SLUG=tv-root
BOOTSTRAP_TENANT_NAME="TextileBill Root"
BOOTSTRAP_TENANT_EMAIL=root@textilebill.local
BOOTSTRAP_COMPANY_NAME="TextileBill Default Company"
```

Optional credential seeding (stored encrypted):

```bash
BOOTSTRAP_EWAYBILL_USERNAME=<eway-user>
BOOTSTRAP_EWAYBILL_PASSWORD=<eway-pass>
BOOTSTRAP_EINVOICE_USERNAME=<einvoice-user>
BOOTSTRAP_EINVOICE_PASSWORD=<einvoice-pass>
```

## 5) Run database setup

```bash
cd textilebill-backend
npm run db:init
npm run db:migrate:deploy
npm run db:bootstrap
```

What this now ensures:
- Required account groups exist.
- `SUPER_ADMIN` + default tenant/company/financial year exist.
- `CompanySettings.defaultFinancialYearId` is maintained.
- Legacy plaintext eWay/eInvoice passwords are backfilled into encrypted columns during bootstrap.

## 6) Start services

Backend:

```bash
cd textilebill-backend
npm run start:dev
```

Frontend (new terminal):

```bash
cd textilebill-frontend
npm run dev
```

## 7) Quick verification

1. Backend up: open `http://localhost:3001/api/docs` (if swagger enabled).
2. Frontend login works for seeded admin account.
3. Protected upload route is not public:
   - `GET /uploads/avatars/<filename>` should require authentication.
4. Auth abuse protection is active on:
   - `POST /api/auth/login`
   - `POST /api/auth/forgot-password`
   - `POST /api/auth/reset-password`
