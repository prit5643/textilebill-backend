# TextileBill Backend Tech Stack

Last updated: `2026-03-30`

## Runtime Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20 |
| Framework | NestJS | 10 |
| Language | TypeScript | 5 |
| ORM | Prisma | 5.22 |
| Database | PostgreSQL | 16 / Supabase |
| Cache / rate limit / idempotency | Redis + ioredis | 5.x |
| Auth | Passport + JWT | NestJS JWT 10.x |
| Validation | class-validator + class-transformer | current |
| Email | Resend | 6.9.x |
| PDF | pdfmake | 0.3.x |
| Queue / resilience | BullMQ, opossum | current |
| Testing | Jest, Supertest | current |

## Core Backend Modules

- `auth`
- `users`
- `tenant`
- `admin`
- `company`
- `account`
- `product`
- `invoice`
- `accounting`
- `report`
- `system`
- `prisma`
- `redis`
- shared `common` guards/decorators/interceptors/filters/utils

## Data Architecture

Current active Prisma models:

- tenancy and identity: `Tenant`, `Company`, `User`, `UserCompany`, `RefreshToken`, `OtpChallenge`
- master data: `Party`, `Account`, `Product`, `FinancialYear`, `VoucherSequence`
- transactions: `Invoice`, `InvoiceItem`, `LedgerEntry`, `StockMovement`
- SaaS billing: `Plan`, `Subscription`

Removed legacy persistence includes:

- `UserCompanyAccess`
- `PasswordLifecycleToken`
- `CompanySettings`
- `ModulePermission`
- `AuditLog`
- `InvoicePayment`
- `InvoiceNumberConfig`
- old category/brand/UOM and book-specific accounting tables

## Authentication Model

- login accepts username/email/mobile identifier input
- persistent identity is email-first on `User`
- company role assignment is stored in `UserCompany`
- session persistence is stored in `RefreshToken`
- OTP persistence is stored in `OtpChallenge`
- browser auth is cookie-based

## Current Verification Status

Verified on `2026-03-30`:

- schema validation passed
- TypeScript compile passed
- backend build passed
- backend unit/integration tests passed
- backend e2e tests passed
