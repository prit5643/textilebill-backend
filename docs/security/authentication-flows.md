# Authentication Flows & RBAC (Role-Based Access Control)

Last updated: `2026-04-13`

This document describes the current auth model and the active Multi-Role/Multi-Tenant permission system.

## 🔐 Multi-Tenant & Multi-Role Architecture

The application implements a robust multi-role authentication system that differentiates between "Global" permissions and "Per-Company" permissions.

### The Identity Hierarchy
1. **Tenant**: The overarching subscription entity (billing, plan limits).
2. **Company**: Sub-branches/entities that belong to a single Tenant.
3. **User**: A person who logs into the platform (belongs to a Tenant).
4. **UserCompany**: The mapping matrix. A single User can belong to multiple Companies, and they can have *distinct roles in each company*.

### Active Roles (`UserRole` Enum)
The database enforces these 5 levels of access:
* `OWNER` (Global `SUPER_ADMIN`): Full access. Can manage tenant billing, create new companies, reset users, and see everything.
* `ADMIN` (Global `TENANT_ADMIN`): Can manage company settings and users, but cannot change billing plans.
* `MANAGER` (Global `MANAGER`): Can create/edit invoices, accounts, and products. **Cannot** change Financial Years, create new Companies, or view sensitive global configs.
* `ACCOUNTANT` (Global `ACCOUNTANT`): Read access + Ledger/Journal entries.
* `VIEWER` (Global `VIEWER`): Read-only mode across the board.

*(Note: In the JWT and Guards, we utilize a `toLegacyRole()` mapper that translates `OWNER` → `SUPER_ADMIN` to remain compatible with NestJS `@Roles()` decorators).*

---

## Current Auth Storage

- `User`
  - stores `email`, `passwordHash`, `name`, `phone`, `status`, `deletedAt`
- `UserCompany`
  - stores per-company `role`
- `RefreshToken`
  - stores hashed refresh/session state
- `OtpChallenge`
  - stores OTP verification state

## No Longer Used As Active Persistence

- `PasswordLifecycleToken`
- `UserCompanyAccess`

The application still accepts `username` in some DTOs and UI forms as a compatibility identifier, but the backend resolves users against the current email/mobile-driven model.

## Main Flows

### 1. Password login

Endpoint:

- `POST /api/auth/login`

Request:

```json
{
  "username": "owner@example.com",
  "password": "ChangeMe@123"
}
```

Behavior:

- resolves identifier from username/email/mobile input
- validates user status and tenant status
- checks company access and subscription guards through the normal protected-session path
- issues auth cookies for:
  - access token
  - session token
  - refresh token
- stores refresh token metadata in `RefreshToken`

### 2. Session lookup

Endpoint:

- `GET /api/auth/me`

Behavior:

- protected by `JwtAuthGuard` and `SubscriptionGuard`
- returns current user plus company access/session payload
- Calculates the user's "highest" role across all their active `UserCompany` assignments to attach a global `role` field.
- If the user tries to access a specific company, `RequireCompanyAccess()` enforces the exact role mapped for that company.

### 3. Token refresh

Endpoint:

- `POST /api/auth/refresh`

Behavior:

- accepts refresh token from cookie first
- rotates auth cookies
- invalidates bad refresh state and clears cookies on failure

### 4. Logout

Endpoint:

- `POST /api/auth/logout`

Behavior:

- revokes refresh token when present
- clears auth cookies

### 5. OTP login / verification

Endpoints:

- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/otp/resend`

Behavior:

- creates and verifies `OtpChallenge` rows
- uses current mail delivery implementation
- issues normal auth cookies after successful OTP verification

### 6. Password reset

Endpoints:

- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/password-reset/request`
- `GET /api/auth/password-reset/validate`
- `POST /api/auth/password-reset/complete`

Behavior:

- OTP reset uses `OtpChallenge`
- secure link reset uses current auth service link-token flow
- legacy password lifecycle table is not used

### 7. Invite acceptance / password setup

Endpoints:

- `GET /api/auth/invite/validate`
- `POST /api/auth/accept-invite`
- `GET /api/auth/password-setup/validate`
- `POST /api/auth/password-setup`
- `POST /api/auth/password-setup/resend`

Behavior:

- user onboarding is supported
- persistence is aligned to current user/session model
- do not assume legacy `PasswordLifecycleToken` records exist

## Sessions and Cookies

Cookies are set and cleared through `auth-cookie.util.ts`.

Important cookies:

- access token cookie
- session token cookie
- refresh token cookie

Important behavior:

- browser sessions are cookie-based
- refresh is cookie-first
- logout clears all auth cookies

## Security Controls

- bcrypt password hashing
- refresh token hashing in persistence
- auth rate limiting for login/forgot/reset
- origin checks before sensitive auth operations
- sanitized auth errors in public responses
- session revocation support

## Current Test Coverage Snapshot

Verified on `2026-03-30`:

- backend unit/integration:
  - `auth.service.spec.ts`
  - `auth.controller.spec.ts`
  - `jwt.strategy.spec.ts`
  - `local.strategy.spec.ts`
  - `otp-delivery.service.spec.ts`
  - `auth-rate-limit.integration.spec.ts`
- backend e2e:
  - `auth.e2e-spec.ts`
  - `auth-rate-limit.e2e-spec.ts`
- frontend:
  - login/session middleware tests
  - Playwright auth suite

## Related Files

- `src/modules/auth/*`
- `src/modules/users/*`
- `src/common/guards/*`
- `src/common/constants/password-token.constants.ts` for compatibility constants only
