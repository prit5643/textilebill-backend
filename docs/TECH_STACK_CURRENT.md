# TextileBill — Technology Stack & Architecture

**Last Updated:** March 21, 2026  
**Version:** 2.0.0  
**Status:** ✅ Production-Ready

---

## 1. Technology Stack (Current Implementation)

### Backend Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Node.js | 20 LTS | JavaScript runtime |
| **Language** | TypeScript | ^5.1.3 | Type-safe development |
| **Framework** | NestJS | ^10.0.0 | Enterprise-grade framework with DI, decorators, guards |
| **HTTP Adapter** | Express | (via NestJS) | HTTP server with middleware ecosystem |
| **ORM** | Prisma | ^5.22.0 | Type-safe database access, migration management |
| **Database** | PostgreSQL | 16 (Supabase) | Primary OLTP database, multi-tenant architecture |
| **Cache & Sessions** | Redis | ^4.8.2 | Rate limiting, OTP storage, session tracking |
| **Authentication** | Passport.js + JWT | @nestjs/jwt ^10.2.0 | Access tokens (15m) + refresh tokens (7d) |
| **Password Hashing** | bcrypt | ^6.0.0 | Secure password storage with salt rounds |
| **Email Service** | Resend SDK | ^6.9.4 | Transactional emails, OTP delivery |
| **PDF Generation** | Puppeteer | @sparticuz/chromium ^129.1.1 | Server-side HTML→PDF for invoices |
| **File Storage** | Local Filesystem | Built-in | Upload storage in `uploads/` folder |
| **Job Queue** | BullMQ | ^5.71.0 | Background job processing |
| **Validation** | class-validator + class-transformer | Latest | DTO validation with decorators |
| **API Documentation** | @nestjs/swagger | ^7.4.2 | Auto-generated OpenAPI/Swagger docs |
| **Security** | Helmet, CORS, HPP | Latest | Security headers, CORS, rate limiting |
| **Testing** | Jest + Supertest | Latest | Unit + E2E testing |

### Frontend Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Framework** | Next.js (App Router) | 14.2.35 | React framework with SSR, routing, API routes |
| **Language** | TypeScript | ^5 | Type-safe development |
| **UI Library** | React | ^18 | Component-based UI |
| **Styling** | Tailwind CSS | ^3.4.1 | Utility-first CSS framework |
| **Component Library** | Radix UI (shadcn/ui) | Latest | Accessible headless components |
| **State (Client)** | Zustand | ^5.0.11 | Lightweight global state management |
| **State (Server)** | TanStack Query | ^5.90.21 | Server state, caching, refetching |
| **Forms** | React Hook Form | ^7.71.2 | Performant form state management |
| **Validation** | Zod | ^4.3.6 | TypeScript-first schema validation |
| **Charts** | Chart.js | ^4.5.1 | Dashboard KPIs and analytics visualization |
| **HTTP Client** | Axios | ^1.13.6 | API requests with interceptors |
| **Toast Notifications** | Sonner | ^2.0.7 | User feedback and alerts |
| **Icons** | Lucide React | ^0.577.0 | Icon library |
| **Date Utils** | date-fns | ^4.1.0 | Date formatting and manipulation |
| **Testing** | Jest + Playwright | Latest | Unit + E2E testing |

---

## 2. Architecture Overview

### Multi-Tenant SaaS Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tenant Layer                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │ Tenant A   │  │ Tenant B   │  │ Tenant C   │   │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘   │
│        │                │                │           │
│  ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐   │
│  │ Company 1  │  │ Company 1  │  │ Company 1  │   │
│  │ Company 2  │  │ Company 2  │  └────────────┘   │
│  │ Company 3  │  └────────────┘                    │
│  └────────────┘                                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              Application Services                    │
│  Authentication │ Invoicing │ Inventory │ Reports   │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│                  Data Layer                          │
│  PostgreSQL │ Redis │ File Storage │ Queue           │
└─────────────────────────────────────────────────────┘
```

### Request Flow

```
User Browser
     │
     ├── HTTPS
     ▼
┌─────────────────┐
│  Next.js App    │  ← Frontend (Vercel/Static Host)
│  (Port 3000)    │  ← SSR + Client-Side Rendering
└────────┬────────┘
         │ API Calls (/api/*)
         ▼
┌─────────────────┐
│  NestJS API     │  ← Backend (Render/EC2)
│  (Port 3001)    │  ← REST API + Swagger Docs
└────────┬────────┘
         │
         ├──────► PostgreSQL (Supabase)
         │         └── Tenant/Company/User data
         │
         ├──────► Redis (Local/Upstash)
         │         └── Sessions, Rate limiting, OTP cache
         │
         ├──────► Resend API
         │         └── Email delivery (OTP, invites, password reset)
         │
         └──────► File System
                   └── Document uploads (avatars, invoices)
```

---

## 3. Backend Module Structure

**Location:** `backend/src/modules/`

### Core Modules

| Module | Purpose | Key Features |
|--------|---------|--------------|
| **auth** | Authentication & Authorization | Login (password/OTP), token management, password lifecycle |
| **tenant** | Tenant management | Tenant CRUD, subscription management |
| **company** | Company management | Multi-company support, settings, financial years |
| **user** | User management | User CRUD, roles, invite system, verification |
| **invoice** | Invoice management | Sales, purchases, quotations, returns, payments |
| **product** | Product master | SKU management, categories, brands, pricing |
| **account** | Customer/Supplier | Chart of accounts, party master, broker management |
| **financial-year** | Financial year | FY configuration, period locking |
| **master-data** | Reference data | Categories, brands, UOMs, account groups |
| **reports** | Dashboard & Analytics | KPIs, charts, financial reports |
| **stock** | Inventory management | Stock movements, adjustments, opening stock |
| **ledger** | Accounting ledger | Double-entry bookkeeping, ledger entries |
| **accounting** | Accounting entries | Journal, cash book, bank book |
| **voucher** | Voucher numbering | Auto-numbering per FY and series |
| **common** | Shared utilities | Guards, decorators, filters, interceptors |

---

## 4. Authentication Architecture

### JWT Token Strategy

**Access Token:**
- Expiry: 15 minutes
- Stored: httpOnly cookie (`SESSION_TOKEN_COOKIE`)
- Contains: userId, tenantId, role, email

**Refresh Token:**
- Expiry: 7 days
- Stored: Database (`RefreshToken` table) + httpOnly cookie
- Features: Device tracking, IP logging, revocation support

### Authentication Flows

1. **Password Login**
   - POST `/auth/login` with email + password
   - Returns access + refresh tokens
   - Creates session entry with device metadata

2. **OTP Login**
   - POST `/auth/otp/request` → sends OTP via Email/WhatsApp
   - POST `/auth/otp/verify` → validates OTP
   - Returns access + refresh tokens

3. **Token Refresh**
   - POST `/auth/refresh` with refresh token cookie
   - Issues new access token
   - Updates `lastUsedAt` timestamp

4. **Password Reset**
   - POST `/auth/forgot-password` → creates `PasswordLifecycleToken`
   - User receives email with secure link
   - POST `/auth/reset-password` → sets new password

5. **Invite System**
   - Admin creates user with `inviteToken`
   - User receives invite email
   - GET `/auth/accept-invite/:token` → setup password

### Security Features

- ✅ bcrypt password hashing (salt rounds)
- ✅ Token hashing in database (`tokenHash` fields)
- ✅ Rate limiting on auth endpoints (Redis-backed)
- ✅ Device fingerprinting (deviceId, userAgent, ipAddress)
- ✅ Session revocation support
- ✅ OTP with expiry and resend limits
- ✅ Email/Phone verification tracking
- ✅ Audit logging (login attempts, password changes)

---

## 5. Database Architecture

### Schema Organization

**33 Total Models across 7 domains:**

1. **SaaS Layer** (3): Plan, Tenant, Subscription
2. **Identity** (4): User, RefreshToken, PasswordLifecycleToken, OtpChallenge
3. **Company** (3): Company, UserCompanyAccess, FinancialYear
4. **Configuration** (2): CompanySettings, ModulePermission
5. **Masters** (7): Product, ProductCategory, Brand, UnitOfMeasurement, Account, AccountGroup, Broker
6. **Transactions** (5): Invoice, InvoiceItem, InvoicePayment, InvoiceNumberConfig, VoucherSequence
7. **Accounting** (5): LedgerEntry, JournalEntry, JournalEntryLine, CashBookEntry, BankBookEntry
8. **Inventory** (3): StockMovement, OpeningStock, StockAdjustment
9. **Audit** (1): AuditLog

### Key Design Patterns

**Multi-Tenancy:**
- All tables have `tenantId` and/or `companyId`
- Row-level security via query filters
- Tenant isolation at application layer

**Soft Deletes:**
- Most entities have `isActive` boolean
- Deleted records are marked inactive, not removed

**Audit Trail:**
- `createdAt` and `updatedAt` on all models
- Dedicated `AuditLog` table for critical actions
- Device and IP tracking on auth events

**Encrypted Fields:**
- `CompanySettings.ewayBillPasswordEnc`
- `CompanySettings.einvoicePasswordEnc`
- Encrypted using `APP_SECRET_KEY`

---

## 6. API Architecture

### REST API Design

**Base URL:** `/api`  
**Format:** JSON  
**Authentication:** JWT Bearer token (in httpOnly cookie)

### Global Guards & Interceptors

| Guard/Interceptor | Purpose |
|-------------------|---------|
| `JwtAuthGuard` | Validates access token on protected routes |
| `RolesGuard` | Enforces role-based access control |
| `SubscriptionGuard` | Checks active subscription status |
| `CompanyAccessGuard` | Validates user access to company |
| `ResponseInterceptor` | Normalizes API responses |
| `GlobalExceptionFilter` | Sanitizes error responses |

### Response Format

```typescript
// Success Response
{
  "data": { /* payload */ },
  "meta": {
    "timestamp": "2026-03-21T08:00:00Z"
  }
}

// Error Response
{
  "statusCode": 400,
  "message": "User-friendly error message",
  "error": "Bad Request",
  "meta": {
    "timestamp": "2026-03-21T08:00:00Z",
    "path": "/api/invoices"
  }
}
```

---

## 7. Frontend Architecture

### App Router Structure

```
frontend/src/app/
├── (auth)/              # Public authentication pages
│   ├── login/
│   ├── forgot-password/
│   ├── reset-password/
│   ├── change-password/
│   └── accept-invite/
│
├── (dashboard)/         # Protected dashboard pages
│   └── dashboard/
│       ├── page.tsx     # Dashboard KPIs
│       ├── invoices/    # Invoice management
│       ├── products/    # Product master
│       ├── accounts/    # Customer/supplier accounts
│       ├── stock/       # Inventory
│       ├── accounting/  # Ledger entries
│       ├── reports/     # Analytics
│       ├── companies/   # Company switcher
│       └── settings/    # User/company settings
│
├── (superadmin)/        # Super admin dashboard
│   └── superadmin/
│
└── (marketing)/         # Public landing pages
    └── page.tsx         # Home page
```

### State Management Strategy

**Client State (Zustand):**
- Auth state (user, companies, active company)
- UI state (sidebar, modals, search filters)
- Persisted to localStorage

**Server State (React Query):**
- API data caching with 1-minute stale time
- Automatic refetching on window focus (disabled)
- Optimistic updates for mutations
- Query invalidation on success

### Authentication Flow (Frontend)

1. **Middleware** (`middleware.ts`):
   - Validates JWT from cookie
   - Redirects unauthenticated users to `/login`
   - Prevents authenticated users from accessing auth pages

2. **Axios Interceptor**:
   - Adds `X-Company-Id` header automatically
   - Handles 401 by refreshing token
   - Handles 403 by logging out (account deactivated)
   - Shows global error toasts for 500+ errors

3. **Session Management**:
   - `useAuthSessionGate()` hook protects routes
   - `useAuthHeartbeat()` keeps session alive
   - Auto-logout on token expiry

---

## 8. Email Service Configuration

### Resend (Current Implementation)

**Provider:** Resend  
**Library:** `resend` SDK  
**Configuration:**

```env
MAIL_ENABLED=true
MAIL_FROM=TextileBill <onboarding@resend.dev>
MAIL_RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
MAIL_RESEND_FROM=TextileBill <billing@yourdomain.com>
MAIL_RESEND_REPLY_TO=support@yourdomain.com
MAIL_ASYNC_QUEUE_ENABLED=false
```

**Email Types:**
- OTP delivery (Email/WhatsApp)
- Password reset links
- User invite emails
- Invoice notifications
- Payment reminders

**Features:**
- Immediate delivery (no queue)
- 10-second timeout
- Retry on failure
- Delivery tracking

---

## 9. File Storage

### Local Filesystem (Current)

**Location:** `backend/uploads/`  
**Structure:**
```
uploads/
├── avatars/        # User profile pictures
├── invoices/       # Invoice PDFs
└── documents/      # Other uploads
```

**Security:**
- Protected routes (authentication required)
- File type validation
- Size limits enforced
- Sanitized filenames

**Future:** AWS S3 integration planned for scalability

---

## 10. Testing Strategy

### Backend Testing

**Unit Tests:**
- Service logic testing
- Guard and decorator testing
- Validation testing

**E2E Tests:**
- API endpoint testing
- Authentication flows
- Multi-tenant isolation
- Business logic workflows

**Test Commands:**
```bash
npm test                    # Unit tests
npm run test:watch          # Watch mode
npm run test:cov            # Coverage report
npm run test:e2e            # E2E tests
npm run test:live:auth      # Live auth verification
```

### Frontend Testing

**Unit Tests:**
- Component testing
- Hook testing
- Utility function testing

**E2E Tests:**
- User flows (Playwright)
- Authentication scenarios
- Data visibility tests

**Test Commands:**
```bash
npm test                              # Unit tests
npm run test:e2e                      # E2E tests
npm run test:automation:data-visibility  # Data isolation tests
```

---

## 11. What's Excluded (For Now)

| Feature | Status | Reason |
|---------|--------|--------|
| AWS S3 | Planned | Local storage sufficient for MVP |
| AWS SES | Not needed | Resend covers current transactional volume |
| SendGrid | Not used | Resend chosen for current implementation |
| NextAuth.js | Not used | Custom JWT auth implemented |
| Fastify | Not used | Express adapter sufficient |
| Excel Export | Future | Not critical for MVP |
| Push Notifications | Future | Email notifications sufficient |

---

## 12. Production Deployment Stack

### Current Production Setup

| Component | Provider | Plan |
|-----------|----------|------|
| **Frontend** | Vercel | Free (100GB bandwidth) |
| **Backend** | Render | Free (750 hrs/month) |
| **Database** | Supabase | Free (500MB PostgreSQL) |
| **Redis** | Local/Upstash | TBD |
| **Email** | Resend | Starter/usage-based |
| **File Storage** | Local | N/A |

**Total Cost:** $0/month (MVP)

---

## 13. Environment Variables

### Backend Environment

**Required:**
```env
NODE_ENV=production
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

DATABASE_URL=postgresql://...
REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-secret>
APP_SECRET_KEY=<encryption-key>

MAIL_ENABLED=true
MAIL_FROM=TextileBill <onboarding@resend.dev>
MAIL_RESEND_API_KEY=<resend-api-key>
MAIL_RESEND_FROM=TextileBill <billing@yourdomain.com>
```

### Frontend Environment

**Required:**
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
JWT_SECRET=<same-as-backend>
NODE_ENV=production
```

---

## 14. Security Best Practices (Implemented)

✅ **Authentication:**
- JWT access + refresh tokens
- Token hashing in database
- Device fingerprinting
- Session revocation support

✅ **Authorization:**
- Role-based access control (RBAC)
- Multi-tenant isolation
- Company-level permissions

✅ **Data Protection:**
- bcrypt password hashing
- Encrypted sensitive fields
- SQL injection prevention (Prisma)
- XSS protection (React escaping)

✅ **Network Security:**
- CORS configuration
- Helmet security headers
- Rate limiting (auth endpoints)
- HTTPS in production

✅ **Audit & Compliance:**
- Audit log table
- Device tracking
- IP address logging
- Session history

---

**Document Version:** 2.0.0  
**Last Verified:** March 21, 2026  
**Schema Version:** 15 migrations (from `20260305121032_init`)  
**Codebase Status:** ✅ Production-Ready
