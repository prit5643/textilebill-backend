# Data Visibility Regression Playbook (AI Agent)

## Goal

Prevent "data created successfully but not visible" failures across the app.

Use this playbook for every feature where data is created, updated, deleted, filtered, or listed.

## Scope

This playbook covers:

- backend write/read contract
- frontend hook response parsing
- table/list rendering
- search/filter/pagination hiding
- cache invalidation after create/update/delete
- tenant/company scope issues

## High-Risk Failure Patterns

1. API response shape mismatch
   - List endpoint returns `{ data, meta }` but hook returns only `data[]`, so table reads `rows = list.data` and becomes empty.
2. Missing tenant/company context
   - Create succeeds in one scope, list fetches another scope (or missing `X-Company-Id`).
3. Query invalidation mismatch
   - Mutation invalidates wrong React Query key, table stays stale.
4. Hidden by UI state
   - Persistent search/filter/page state hides newly created row.
5. Soft delete/state mismatch
   - New record has status not shown by default list filter.
6. Backend include mismatch
   - List endpoint omits relation fields used by table columns.

## Standard Verification Chain (Mandatory)

For each module, follow this exact sequence:

1. Create record (UI or API).
2. Verify DB row exists with expected scope (`companyId`, `tenantId`, `isActive`, etc.).
3. Verify `GET list` endpoint includes record with same filters/scope.
4. Verify frontend hook returns expected list contract (not downgraded/flattened unexpectedly).
5. Verify table/list renders row and key columns.
6. Verify search, filter, and pagination still find/show the record.
7. Verify mutation invalidation refreshes list without page reload.

Do not close a bug until all 7 checks pass.

## Module Coverage Matrix

Run all rows below during regression.

| Module | Create Path | List Path | Hook | Backend |
|---|---|---|---|---|
| Products | `/dashboard/products/new` | `/dashboard/products` | `textilebill-frontend/src/lib/hooks/useProducts.ts` | `textilebill-backend/src/modules/product/*` |
| Accounts | `/dashboard/accounts/new` | `/dashboard/accounts` | `textilebill-frontend/src/lib/hooks/useAccounts.ts` | `textilebill-backend/src/modules/account/*` |
| Invoices | `/dashboard/invoices/new` | `/dashboard/invoices` | `textilebill-frontend/src/lib/hooks/useInvoices.ts` | `textilebill-backend/src/modules/invoice/*` |
| Companies | `/dashboard/companies` | `/dashboard/companies` | `textilebill-frontend/src/lib/hooks/useCompanies.ts` | `textilebill-backend/src/modules/company/*` |
| Stock Opening | `/dashboard/stock` | `/dashboard/stock` | `textilebill-frontend/src/lib/hooks/useAccounting.ts` | `textilebill-backend/src/modules/accounting/*` |
| Stock Adjustments | `/dashboard/stock` | `/dashboard/stock` | `textilebill-frontend/src/lib/hooks/useAccounting.ts` | `textilebill-backend/src/modules/accounting/*` |
| Cash Book | `/dashboard/accounting` | `/dashboard/accounting` | `textilebill-frontend/src/lib/hooks/useAccounting.ts` | `textilebill-backend/src/modules/accounting/*` |
| Bank Book | `/dashboard/accounting` | `/dashboard/accounting` | `textilebill-frontend/src/lib/hooks/useAccounting.ts` | `textilebill-backend/src/modules/accounting/*` |
| Journal Entries | `/dashboard/accounting` | `/dashboard/accounting` | `textilebill-frontend/src/lib/hooks/useAccounting.ts` | `textilebill-backend/src/modules/accounting/*` |
| Brokers | settings/account flows | selection/list UIs | `textilebill-frontend/src/lib/hooks/useAccounts.ts` | `textilebill-backend/src/modules/account/*` |
| Categories/Brands | product flows | product filters/forms | `textilebill-frontend/src/lib/hooks/useProducts.ts` | `textilebill-backend/src/modules/product/*` |
| Super Admin (Tenants/Plans/Subscriptions/Users) | `/superadmin` | `/superadmin` | `textilebill-frontend/src/lib/hooks/useAdmin.ts` | `textilebill-backend/src/modules/admin/*` |

## Contract Rules (Must Hold for Every List API)

1. Decide and document list response contract:
   - preferred: `PaginatedResponse<T>` => `{ data: T[]; meta: {...} }`
2. Hook must return exactly what UI expects.
3. Page components must read rows from the same agreed shape.
4. Add parser tests when endpoints have mixed/legacy envelopes.

Reference parser pattern:

- `textilebill-frontend/src/lib/paginated-response.ts`
- `textilebill-frontend/src/lib/paginated-response.spec.ts`

## Agent Test Checklist (Copy/Paste per Module)

```md
### <MODULE NAME>
- [ ] Create API returns success and ID
- [ ] DB row exists with correct scope fields
- [ ] GET by ID returns created record
- [ ] GET list includes created record (default filters)
- [ ] GET list includes record when searched by unique value
- [ ] Frontend hook returns expected shape (rows + pagination metadata if applicable)
- [ ] Table/list renders new record
- [ ] Search/filter/page controls do not hide record unexpectedly
- [ ] After create/update/delete, list refreshes without manual reload
- [ ] No raw Prisma/SQL/internal errors shown to end user
```

## Regression Test Types To Maintain

1. Hook contract tests
   - Validate response shape normalization.
2. Page render tests
   - Mock list payload and assert row is visible.
3. Create-to-list integration tests
   - Mock mutation success and verify query invalidation/refetch path.
4. Backend service tests
   - Verify scoped list queries and expected includes.
5. E2E smoke (optional but recommended)
   - Create record in UI, assert it appears in list immediately.

## Current Automation Suite Location

Frontend automation folder:

- `textilebill-frontend/automation-tests/data-visibility/`

Run command:

```bash
cd textilebill-frontend
npm run test:automation:data-visibility
```

## Minimum Pre-Release Gate

Before merge/release, pass:

1. all affected module checklists above
2. unit/integration tests for changed hooks/pages/services
3. one full create->list smoke run for Products, Accounts, Invoices

## Triage Template (When Visibility Bug Is Found)

Capture all fields below:

1. Module and UI route
2. Create request payload and response
3. List request payload (query params + headers) and response
4. Active search/filter/page state
5. Active company/tenant identifiers
6. Hook returned value snapshot
7. Render condition used by page (`rows = ...`)
8. Request ID from backend response

## Known Codebase-Specific Guardrails

1. Keep list hook outputs aligned with page expectations (`PaginatedResponse<T>`).
2. Always verify company scoping header flow:
   - frontend: `textilebill-frontend/src/lib/axios.ts`
   - backend: `textilebill-backend/src/common/middleware/tenant.middleware.ts`
3. Keep error messages user-safe:
   - frontend: `textilebill-frontend/src/lib/error-message.ts`
   - backend: `textilebill-backend/src/common/filters/global-exception.filter.ts`
4. Reset/search pagination interactions can hide records; always test with cleared filters.

## Done Criteria

A visibility issue is considered fixed only when:

1. root cause is identified in one layer (API/hook/UI/state/scope)
2. regression test exists for that failure mode
3. module checklist for impacted module passes end-to-end
