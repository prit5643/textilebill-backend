# TextileBill ERP — Role & Permission Reference

> **Source of truth:** `textilebill-backend/prisma/schema.prisma` → `enum UserRole`
>
> Roles are stored per user **per company** in the `UserCompany` join table.
> This means the same person can be a `MANAGER` in Company A and a `VIEWER` in Company B simultaneously.

---

## Role Hierarchy

```
OWNER
  └── ADMIN
        └── MANAGER
              ├── ACCOUNTANT
              └── VIEWER
```

Higher roles inherit all capabilities of lower roles unless otherwise stated.

---

## 1. OWNER

> **"The Platform Super-Admin — owns the entire TextileBill instance."**

### Who is this?
The OWNER is the top-level administrator of the TextileBill SaaS platform itself. This is typically the **developer / deployer** of the application. There is usually **one OWNER per deployment**. OWNER accounts are provisioned manually or through the super-admin panel — they cannot be created through the normal tenant onboarding flow.

### What they see
- The **`/superadmin`** dashboard (completely separate from the tenant dashboards).
- A list of all tenants, their subscription plans, usage stats, billing details.
- Full visibility into all companies registered across all tenants.

### Permissions

| Capability | Allowed |
|------------|---------|
| Access `/superadmin` panel | ✅ |
| Create / manage tenants | ✅ |
| Create / delete subscription plans | ✅ |
| Assign subscription plans to tenants | ✅ |
| Create the first `ADMIN` user for a tenant | ✅ |
| View all companies across all tenants | ✅ |
| Soft-delete or suspend any tenant | ✅ |
| Impersonate / inspect tenant data | ✅ (internal tooling) |
| Manage their own user profile | ✅ |
| Access any `/dashboard` tenant page | ❌ Redirected to `/superadmin` |

### Capacity Notes
- **Not counted** toward any tenant's `maxUsers` plan limit.
- Has **no active company context** — operates at the tenant/platform level.
- Provisioned via `admin.service.ts → createTenant()` or direct DB seed.

---

## 2. ADMIN

> **"The Tenant Admin — a paying customer given full control over their own business."**

### Who is this?
The ADMIN is the **primary account holder** for a tenant (a business subscribing to TextileBill). This person sets up the workspace: creates companies, invites users, and manages company-level settings. They are created automatically when a tenant is provisioned by an OWNER.

### What they see
- All pages within `/dashboard`.
- Full company settings, billing/plan usage, and user management screens.
- Can see and manage all companies within their own tenant.

### Permissions

| Capability | Allowed |
|------------|---------|
| Create / manage companies within their tenant | ✅ |
| Invite users and assign roles (MANAGER, ACCOUNTANT, VIEWER) | ✅ |
| Deactivate or remove users | ✅ |
| Set per-company settings (GST, invoice number series, etc.) | ✅ |
| Change their own GSTIN (locked once set unless OWNER intervenes) | ✅ |
| Create / edit / delete invoices | ✅ |
| Create / edit / delete accounts (parties) | ✅ |
| Create / edit / permanently delete products | ✅ |
| Create / edit / delete expenses | ✅ |
| Create / edit work orders | ✅ |
| View reports and accounting ledger | ✅ |
| Create product classifications, brands, categories | ✅ |
| Access `/superadmin` | ❌ |

### Capacity Notes
- Subject to their tenant's `Plan.maxUsers` and `Plan.maxCompanies` limits.
- Automatically assigned as the `ADMIN` in every company they create.
- One tenant can have **multiple ADMIN users** if manually added.

---

## 3. MANAGER

> **"Operations manager — creates and manages all business transactions, but cannot change structural settings."**

### Who is this?
A MANAGER is an employee-level user assigned by an ADMIN to run day-to-day operations for one or more specific companies. Typical example: a shop floor manager, a sales executive, or a logistics coordinator.

### What they see
- All `/dashboard` pages for their assigned companies.
- Cannot see company settings, billing, or user management.

### Permissions

| Capability | Allowed |
|------------|---------|
| Create / edit invoices (all types) | ✅ |
| Create / edit accounts (parties) | ✅ |
| Create / edit products | ✅ |
| Create product classifications, brands, categories | ✅ |
| Create / edit work orders | ✅ |
| View reports and ledger | ✅ |
| Read company settings | ✅ |
| Create / edit expenses | ✅ |
| Permanently delete products | ❌ (needs ADMIN) |
| Permanently delete accounts | ❌ (needs ADMIN) |
| Invite or manage users | ❌ |
| Update company settings | ❌ |
| Access `/superadmin` | ❌ |

### Capacity Notes
- Role is **per company** — a MANAGER in Company A has no access to Company B unless explicitly assigned.
- Cannot escalate permissions or create users.

---

## 4. ACCOUNTANT

> **"Finance & ledger specialist — reads everything, manages accounting entries only."**

### Who is this?
An ACCOUNTANT is a finance-focused user who needs to read all financial data and post manual accounting entries, but should not create or modify invoices, products, or parties. Typical example: an external chartered accountant, internal bookkeeper.

### What they see
- All `/dashboard` pages for their assigned companies (read-only for most).
- Full accounting and ledger module with write access.

### Permissions

| Capability | Allowed |
|------------|---------|
| Read all invoices, accounts, products | ✅ |
| View all reports and ledger | ✅ |
| Read product classifications, brands, categories, UOM | ✅ |
| Post manual ledger / journal entries | ✅ |
| Create / edit accounts (limited — follows account controller rules) | ✅ |
| Create invoices | ❌ |
| Edit or delete invoices | ❌ |
| Create / edit products | ❌ |
| Create / edit expenses | ❌ |
| Manage users | ❌ |
| Change company settings | ❌ |

### Capacity Notes
- Primarily a **read + ledger-write** role.
- Good for external auditors who need to verify without being able to accidentally alter transaction records.

---

## 5. VIEWER

> **"Read-only observer — can see everything but change nothing."**

### Who is this?
A VIEWER is a stakeholder who needs visibility into the business data but should not be able to modify anything. Typical example: a silent business partner, an investor, a supervisor checking reports.

### What they see
- All list/detail pages within `/dashboard` (read-only).
- Explicitly **blocked** from all creation, editing, and settings routes by the Next.js middleware.

### Permissions

| Capability | Allowed |
|------------|---------|
| View all invoice lists and details | ✅ |
| View all account (party) lists and details | ✅ |
| View all product lists | ✅ |
| View all reports and ledger | ✅ |
| View work orders | ✅ |
| Navigate to `/new`, `/add`, `/edit` routes | ❌ Redirected to `/dashboard` |
| Navigate to `/settings` | ❌ Redirected to `/dashboard` |
| Create any record | ❌ |
| Edit any record | ❌ |
| Delete any record | ❌ |
| Manage users | ❌ |

### Capacity Notes
- Route-level protection is enforced in `src/middleware.ts` (Next.js edge middleware) — navigation to write routes is blocked before any React code runs.
- Backend API endpoints are not explicitly blocked for VIEWER in all controllers (some endpoints don't carry a `@Roles` restrictor), so **VIEWER access should always be enforced at the middleware layer** for full safety.

---

## Permission Matrix Summary

| Feature / Action | OWNER | ADMIN | MANAGER | ACCOUNTANT | VIEWER |
|---|:---:|:---:|:---:|:---:|:---:|
| Superadmin panel | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage tenants & plans | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create companies | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage users & roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| Update company settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit GSTIN after initial set | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create / edit invoices | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create / edit accounts | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create / edit products | ✅ | ✅ | ✅ | ❌ | ❌ |
| Permanently delete products | ✅ | ✅ | ❌ | ❌ | ❌ |
| Permanently delete accounts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create product categories/brands | ✅ | ✅ | ✅ | ✅ (read) | ❌ |
| Create / edit expenses | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create / edit work orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| Post ledger / accounting entries | ✅ | ✅ | ✅ | ✅ | ❌ |
| View reports & ledger | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all lists (invoices, accounts, products) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## How Roles are Enforced

### Backend (API layer)
- **`@Roles()`** decorator on controller methods (via `RolesGuard` + `JwtAuthGuard`).
- The JWT token carries `role` and `companyId` claims.
- The `CompanyContextGuard` additionally validates that the `X-Company-Id` header belongs to the authenticated user's allowed companies.

### Frontend (UI/Route layer)
- **Next.js middleware** (`src/middleware.ts`) validates the JWT at the edge before any React code runs.
  - `OWNER` → redirected from `/dashboard` to `/superadmin`.
  - `VIEWER` → blocked from any route containing `/new`, `/add`, `/edit`, or `/settings`.
- **`useAuthSessionGate`** hook validates the session in client-side layout components and redirects stale sessions.
- **`isAdmin` checks** in page components (`user.role === 'OWNER' || user.role === 'ADMIN'`) conditionally render admin-only action buttons (e.g., "Delete Permanently").

---

## Role Assignment Rules

| Who can assign | To whom | What roles |
|---|---|---|
| OWNER | New tenant's first user | ADMIN |
| ADMIN | Any user within their tenant | MANAGER, ACCOUNTANT, VIEWER |
| MANAGER | Nobody | — |
| ACCOUNTANT | Nobody | — |
| VIEWER | Nobody | — |

> An ADMIN **cannot** grant ADMIN or OWNER level to another user unless they are themselves an OWNER acting through the superadmin panel.

---

## Database Schema

```prisma
// Stored in: textilebill-backend/prisma/schema.prisma

enum UserRole {
  OWNER       // full access, can manage users
  ADMIN       // manage company settings
  MANAGER     // create/edit invoices
  ACCOUNTANT  // read + ledger
  VIEWER      // read only
}

// Per-company role — a user can be MANAGER in Company A, VIEWER in Company B
model UserCompany {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String
  companyId String
  role      UserRole   // the effective role for THIS company

  @@unique([userId, companyId])
}
```

---

## Known Gaps (As-of April 2025)

> [!WARNING]
> The following inconsistencies exist in the current codebase and should be addressed.

1. **Backend `@Roles` decorators still use old string names** (`'SUPER_ADMIN'`, `'TENANT_ADMIN'`) instead of the canonical Prisma enum values (`'OWNER'`, `'ADMIN'`). This means the `RolesGuard` comparison must map these strings to the actual `UserRole` enum at runtime. **All `@Roles()` arguments in backend controllers should be migrated to the canonical enum names** for clarity and to eliminate silent mismatches.

2. **VIEWER has no explicit API-level block.** A determined user who submits a `POST /api/invoices` request directly (bypassing the UI) with a VIEWER JWT may succeed on endpoints that lack a `@Roles()` guard. A global guard that denies write methods (`POST`, `PUT`, `PATCH`, `DELETE`) for VIEWER should be added.

3. **ACCOUNTANT write permissions on accounts** — the `account.controller.ts` includes ACCOUNTANT in some write paths. This should be reviewed against business requirements; typically accountants should not be creating new parties.
