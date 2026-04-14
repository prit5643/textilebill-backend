# Application Features

Last updated: `2026-04-13`

This file lists currently implemented features only.

## Authentication, Multi-Tenancy & Roles (RBAC)

- password login, OTP request, resend, and verification
- cookie-based session, refresh, and logout
- password change and password reset flows
- invite and password-setup flows
- **Multi-Tenant System:** `Tenant` (subscription owner) handles billing/limits, while `Company` handles business entities (branches).
- **Role-Based Access Control:** Users are assigned roles (`OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `VIEWER`) on a *per-company basis* (via `UserCompany` mapping).
- Application securely enforces `@Roles(...)` and `RequireCompanyAccess()` depending on the user's specific context. Note: `MANAGER` and below are restricted from globally impacting elements like billing and Financial Year syncing.
- auth endpoint rate limiting

## Tenant and Admin

- tenant profile APIs
- admin dashboard
- tenant CRUD/toggle
- user administration, activation/deactivation, resend setup/reset link
- plan and subscription management
- compatibility responses for deprecated audit/module-permission surfaces

## Company and Financial Year

- company create/list/update/delete
- company usage/limits endpoint
- compatibility settings endpoints
- financial year create/list/activate

## Accounts and Parties

- account CRUD
- permanent delete support
- enum-based account grouping via `AccountGroupType`
- selector/list payloads for UI pickers
- compatibility broker endpoints

## Products

- product CRUD
- permanent delete support
- selector/list payloads
- schema-aligned pricing, tax, and HSN fields

## Invoices

- invoice create/list/get/update/delete
- invoice PDF endpoint
- invoice summary endpoint
- invoice payment recording/list/delete
- invoice conversion support
- voucher-sequence-based numbering
- immutable versioning support via current invoice schema

## Expenses & Reimbursements

- general and work-order specific expense logging
- expense categorical cost centers
- bulk file attachment tracking directly into unified API responses
- auto-advance matching directly to payroll settlements
- reimbursement claims for salary adjustment/withholding

## Work Orders (Outsourced Capacity)

- creation, splitting, and tracking internal vs outsourced lots
- invoice linking (sale and purchase)
- capacity and loss incident tracking (auto expense adjustments/charge-backs)
- real-time profitability/margin visibility (calculates revenue against out-of-pocket tracking)
- vendor risk monitoring

## Accounting and Inventory

- cash/bank/journal style compatibility endpoints
- ledger and ledger-summary endpoints
- opening balances / stock adjustment compatibility flows mapped to current ledgers
- deterministic voucher numbering
- stock reporting and movement tracking through `StockMovement`

## Reports

- dashboard summary
- monthly chart
- outstanding debtors and creditors
- day book
- stock and product detail reports
- GST reports
- trial balance, profit/loss, balance sheet

## Platform Reliability

- readiness and health endpoints
- global validation and error sanitization
- request logging and slow-request observability
- idempotency protection
- Swagger gating by environment
