# Application Features

Last updated: `2026-03-30`

This file lists currently implemented features only.

## Authentication and Access

- password login
- OTP request, resend, and verification
- cookie-based session, refresh, and logout
- password change and password reset flows
- invite and password-setup flows
- role guards, company access checks, subscription enforcement
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
