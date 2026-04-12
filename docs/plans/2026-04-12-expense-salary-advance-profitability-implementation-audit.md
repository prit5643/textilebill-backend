# Expense/Salary/Profitability Backend Implementation Audit

Date: 2026-04-12  
Scope: `2026-04-09-expense-salary-advance-profitability-backend-plan.md`

## Implemented

- Expense module endpoints implemented:
  - People, categories, entries, submit, attachments, listing/filtering.
- Payroll module endpoints implemented:
  - Salary profiles, advances, settlement run (preview/finalize), list settlements, mark paid.
- Reimbursements module endpoints implemented:
  - Claims list/create/settle, claim attachments list/upload/delete.
- Cost center module endpoints implemented:
  - Cost centers list/get/create, allocations list/create with over-allocation guard.
- Profitability reporting endpoints implemented:
  - `/reports/profitability/cost-centers` and `/reports/profitability/cost-centers/:id`.
- AI insights endpoints implemented:
  - expense anomalies, cost hotspots, salary advance risk, margin leakage.
- Attachment uploads implemented via direct authenticated multipart endpoints:
  - `POST /expenses/:id/attachments`
  - `POST /reimbursements/claims/:id/attachments`

## Tightening Done

- Fixed dashboard outstanding KPI merge regression:
  - outstanding receivable/payable now correctly include only `SALE` and `PURCHASE`.
- Attachment flow tightened to local-only storage and direct endpoint contract.

## Validation/Security Coverage Present

- DTO validation is enabled for create/update flows in expenses/payroll/reimbursements/cost-centers.
- Company scoping guard + subscription guard + JWT guard applied on module controllers.
- Attachment upload checks:
  - MIME allowlist check.
  - Magic-bytes content validation.
  - Duplicate file detection via hash.
  - Path-safe serving for uploads controller.

## Test/Build Verification (Executed)

- Unit tests:
  - `src/modules/expenses/expenses.service.spec.ts`
  - `src/modules/report/report.service.spec.ts`
  - `src/modules/invoice/invoice.service.spec.ts`
  - `src/modules/expenses/expense-attachment.util.spec.ts`
  - `src/modules/cost-centers/cost-allocation.util.spec.ts`
- E2E tests:
  - `test/report-contract.e2e-spec.ts`
  - `test/protected-route-contract.e2e-spec.ts`
- Build:
  - `npm run build` passed.

## Pending / Gaps

- Lint baseline:
  - `npm run lint` currently fails with many pre-existing Prettier/format errors across multiple modules.
  - These are not isolated to expense/salary/profitability changes.
- Attachment storage mode:
  - Local-only storage is now the explicit requirement and implementation.
  - Files are served from `/uploads/expenses/*`.
- Future-ready approval schema:
  - `ExpenseApprovalPolicy` and `ExpenseApprovalStep` models are not present in Prisma schema yet.
- Backend E2E depth:
  - No dedicated backend E2E suite yet for full expense -> attachment -> reimbursement -> salary settlement -> profitability chain in one scenario.

## Cleanup Notes

- Current working tree includes deletion of:
  - `docs/plans/2026-04-09-bill-ocr-autofill-backend-plan.md`
- This file deletion is not required for expense/salary/profitability delivery.
- Recommend explicit keep/delete decision before commit.
