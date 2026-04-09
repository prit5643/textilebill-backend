# Expense, Salary Advance, and Profitability Module - Backend Plan

Date: 2026-04-09
Status: Planning only (no implementation in this document)
Owner: Codex planning artifact for future build

## 1) Why this module

You want a single accounting flow for:
- daily company expenses (rent, machine maintenance, utilities, misc)
- people-linked expenses (manager paid from pocket, worker advances)
- month-end salary settlement with advance/reimbursement adjustment
- purchase -> processing -> sale profitability tracking
- bill/photo proof storage and later verification
- analytics and AI suggestions for cost control

The backend already has strong multi-tenant accounting/invoice/ledger foundations. This plan extends those foundations instead of creating a disconnected subsystem.

## 2) Scope and boundaries

In scope:
- Expense entry lifecycle (no approval gate in v1)
- Salary profile, salary advances, salary settlement
- Reimbursement claims and settlement workflow
- Attachments (bill images, PDF proofs)
- Cost-center or lot-based profitability model (v1 baseline)
- Monthly/weekly/yearly analytics APIs
- AI insight endpoints over normalized data

Out of scope (phase 1):
- statutory payroll filing automation
- bank statement auto-ingestion
- full OCR accounting automation (we keep OCR assist optional)
- non-employee payee flows (vendors/contractors) in this module's person table for v1

## 3) Proposed domain model

### 3.1 New enums

- `PersonType`: `PARTNER`, `MANAGER`, `WORKER`, `ACCOUNTANT`, `OTHER`
- `ExpenseSourceType`: `COMPANY_CASH`, `COMPANY_BANK`, `PERSONAL_OUT_OF_POCKET`
- `ExpenseStatus`: `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `SETTLED`
- `SettlementMode`: `SALARY_DEDUCTION`, `SALARY_ADDITION`, `DIRECT_PAYMENT`, `CARRY_FORWARD`
- `AttachmentType`: `BILL_IMAGE`, `INVOICE_PDF`, `PAYSLIP`, `OTHER`
- `CostCenterType`: `MONTHLY_POOL`, `PRODUCTION_LOT`, `ORDER`, `DEPARTMENT`, `MACHINE`

### 3.2 New core tables

1. `CompanyPerson`
- Purpose: represent employee/partner people involved in expense/salary flow (with or without login user account)
- Key fields: `id, tenantId, companyId, linkedUserId?, name, personType, phone?, status, joinedAt?, leftAt?`
- v1 rule: keep this table employee/partner-focused only; do not include vendors/contractors

2. `ExpenseCategory`
- Purpose: configurable buckets (`rent`, `machine maintenance`, `salary`, `utilities`, `transport`, etc.)
- Key fields: `id, companyId, code, name, parentId?, isSystem, isActive`

3. `ExpenseEntry`
- Purpose: one expense event, always auditable
- Key fields:
  - `id, tenantId, companyId, categoryId, personId?`
  - `date, amount, sourceType, paidByPersonId?, notes`
  - `status, approvalBy?, approvalAt?`
  - `linkedLedgerEntryId?` (for accounting reconciliation)
  - `costCenterId?` (for profitability allocation)
  - `createdBy, updatedBy, deletedAt?`

4. `ExpenseAttachment`
- Purpose: one-to-many proof attachments per expense/claim
- Key fields: `id, expenseEntryId?, reimbursementClaimId?, filePath, mimeType, sizeBytes, attachmentType, uploadedBy`

5. `SalaryProfile`
- Purpose: recurring monthly salary config per person
- Key fields: `id, companyId, personId, monthlyGross, effectiveFrom, effectiveTo?, isActive`

6. `SalaryAdvance`
- Purpose: worker/manager takes advance before salary date
- Key fields: `id, companyId, personId, amount, advanceDate, reason?, status, remainingAmount`

7. `SalarySettlement`
- Purpose: monthly payroll settlement record
- Key fields:
  - `id, companyId, personId, year, month`
  - `grossSalary, advanceDeduction, reimbursementAddition, otherAdjustments, netPayable`
  - `paidAmount, paidDate?, carryForwardAmount`
  - unique constraint on `(companyId, personId, year, month)`

8. `ReimbursementClaim`
- Purpose: employee/manager paid from pocket and requests reimbursement
- Key fields: `id, companyId, personId, claimDate, amount, notes, status, settlementMode, settledInSalarySettlementId?`

9. `CostCenter`
- Purpose: connect expenses + purchases + sales for profitability
- Key fields: `id, companyId, name, code, costCenterType, startDate, endDate?, metadataJson`

10. `CostAllocation`
- Purpose: allocate indirect costs to cost center or invoice
- Key fields: `id, companyId, expenseEntryId, costCenterId, allocatedAmount, allocationRule, allocationBasis`

11. `ExpenseApprovalPolicy` (future-ready, disabled in v1)
- Purpose: support threshold-based and multi-level approvals later without schema redesign
- Key fields: `id, companyId, isEnabled, effectiveFrom, minAmount, maxAmount?, createdBy`

12. `ExpenseApprovalStep` (future-ready, disabled in v1)
- Purpose: define ordered approval levels for an active policy
- Key fields: `id, policyId, stepOrder, approverRole, approverUserId?, requiredApprovals`

### 3.3 Use existing tables where possible

- `Invoice` and `InvoiceItem` remain source of purchase/sale transaction values
- `LedgerEntry` remains financial truth for book impact
- `VoucherSequence` can generate expense/salary voucher numbers

## 4) Key workflows

### 4.1 Daily expense entry
1. Manager/accountant creates expense with category, amount, date, payer, notes.
2. Optional bill photo/PDF attached.
3. Expense can stay `DRAFT` or move to `SUBMITTED`.
4. In v1, submitted expense can move directly to settlement/ledger flow per category policy.
5. Future: same workflow can route via multi-level approvals when policy is enabled.

### 4.2 Salary advance and month-end deduction
1. Advance recorded against `CompanyPerson`.
2. `remainingAmount` updated as deductions happen.
3. Salary run is monthly only in v1.
4. Salary settlement engine computes `netPayable = gross - advances + reimbursements +/- adjustments`.
5. Ledger impact for advance/reimbursement adjustments is posted at salary settlement time (not at draft/add time).
6. Partial settlement allowed; remaining carry-forward supported.

### 4.3 Pocket expense reimbursement
1. Person submits reimbursement claim with proofs.
2. In v1, accountant/owner can settle directly (no approval queue).
3. Claim is visible immediately in pending-adjustment views.
4. Settle by direct payment or salary addition in current/next cycle.
5. Audit trail links claim -> settlement -> ledger entry.

### 4.4 Purchase to sale profitability
1. Purchase invoices + direct process expenses linked to a `CostCenter`.
2. Shared overhead allocated via allocation rules (machine-hours, quantity, equal split, manual).
3. Sales invoices linked to same cost center.
4. API computes:
   - total cost (purchase + process + allocated overhead)
   - sales revenue
   - gross margin and margin percent

## 5) API planning

## 5.1 People and categories
- `POST /expenses/people`
- `GET /expenses/people`
- `PATCH /expenses/people/:id`
- `POST /expenses/categories`
- `GET /expenses/categories`

## 5.2 Expense entries
- `POST /expenses`
- `GET /expenses`
- `GET /expenses/:id`
- `PATCH /expenses/:id`
- `POST /expenses/:id/submit`

## 5.3 Attachments
- `POST /expenses/:id/attachments` (supports cloud object storage metadata)
- `GET /expenses/:id/attachments`
- `DELETE /expenses/attachments/:attachmentId`
- `POST /expenses/attachments/presign` (v1 cloud upload helper)

## 5.4 Salary and advances
- `POST /payroll/salary-profiles`
- `GET /payroll/salary-profiles`
- `POST /payroll/advances`
- `GET /payroll/advances`
- `POST /payroll/settlements/run` (company + month + year)
- `GET /payroll/settlements`
- `POST /payroll/settlements/:id/mark-paid`

## 5.5 Reimbursements
- `POST /reimbursements/claims`
- `GET /reimbursements/claims`
- `POST /reimbursements/claims/:id/settle`

## 5.6 Costing and profitability
- `POST /cost-centers`
- `GET /cost-centers`
- `POST /cost-centers/:id/allocations`
- `GET /reports/profitability/cost-centers`
- `GET /reports/profitability/cost-centers/:id`

## 5.7 AI insights
- `GET /ai/insights/expense-anomalies`
- `GET /ai/insights/cost-hotspots`
- `GET /ai/insights/salary-advance-risk`
- `GET /ai/insights/margin-leakage`

Future approval endpoints (not part of v1 delivery):
- `POST /expenses/:id/approve`
- `POST /expenses/:id/reject`
- `POST /reimbursements/claims/:id/approve`
- `POST /reimbursements/claims/:id/reject`
- `POST /expenses/approval-policies`
- `GET /expenses/approval-policies`

## 6) AI layer design

Input signals:
- expense frequency and amount trends
- late entries and month-end posting backlog
- missing attachment rates
- recurring machine cost spikes
- salary advance dependence per worker/team
- margin variance by cost center

Output examples:
- "Machine maintenance in March is 38% higher than 3-month average"
- "3 claims were settled without proof"
- "Cost center DYE-APR-02 margin dropped below target due to overhead spike"
- "Worker advance ratio indicates probable month-end salary stress"

Safety and controls:
- AI returns recommendations, never auto-posts financial entries
- include confidence score and explainable factors for each insight

## 7) Edge cases and failure scenarios

- Advance > salary for month -> carry forward automatically, never negative payout bug
- Reimbursement submitted after payroll run -> deferred to next cycle with explicit status
- Backdated expense is allowed in v1, with audit trail and reporting impact clearly visible
- Duplicate bill upload -> hash-based duplicate detection
- Same person in multiple companies -> strict company scoping by `X-Company-Id`
- Soft-deleted person with pending salary/advance -> block deletion, mark inactive only
- Partial proof (one file missing) -> claim can remain pending
- Currency precision -> use Decimal consistently, no float math

## 8) Security, audit, and permissions

- No role-based restriction is enforced in v1 for this module (current product constraint).
- Maintain full audit fields on every mutable record: `createdBy`, `updatedBy`, timestamps, and settlement markers.
- Future-ready role policy can be activated once role infrastructure is available.
- When future approval mode is enabled, every approval/rejection must persist `who`, `when`, and note.
- Attachment endpoints must validate mime type and path safety.
- Attachment files are stored in cloud object storage from day 1; DB stores only metadata and secure URLs/keys.
- PII minimization: only required employee fields.

## 9) Performance and reporting strategy

- Add composite indexes on `(companyId, date, status, categoryId)` for `ExpenseEntry`
- Precompute monthly aggregates in materialized summary table (or cache) for dashboard speed
- Keep heavy profitability computations behind async job + cached snapshots for large datasets

## 10) Migration and rollout plan

Phase 0 - design freeze
- finalize entities and approval policy

Phase 1 - foundational schema
- add tables/enums, migrations, and seed system categories

Phase 2 - core expense APIs
- people, categories, expenses, attachments, direct settlement flow

Phase 3 - payroll adjustments
- salary profile, advances, settlement engine

Phase 4 - profitability
- cost center, allocation, profitability reports

Phase 5 - AI insights
- rule-based insights first, model-assisted narrative later

Phase 6 - hardening
- audit validation, load tests, reconciliation checks

## 11) Testing strategy

Unit tests:
- settlement math, carry-forward logic, allocation formulas, duplicate guard

Integration tests:
- expense -> submit -> no immediate ledger posting -> salary settlement ledger posting
- advance + reimbursement -> salary settlement
- cost center profitability with mixed direct/allocated costs

E2E tests:
- manager logs expense with bill, entry is visible immediately, month-end salary run posts adjustment to ledger

Data consistency checks:
- sum of allocations per expense cannot exceed source amount
- backdated edits must remain auditable and trigger report recalculation consistently

## 12) Paper-to-digital mapping for textile operations

Common physical artifacts to support:
- rent receipts
- machine maintenance bills
- salary/advance notebooks
- petty cash vouchers
- purchase bills and delivery challans
- GRN (goods receipt note) and supplier invoice pair

Digitization model:
- upload as `ExpenseAttachment`
- tag by category, vendor/person, and date
- link to expense/claim/cost center for later audit and analytics

## 13) Market-informed product cues (what others do)

Observed patterns from current tools:
- Salary advances and reimbursement adjustments are explicit payroll constructs in TallyPrime.
- SMB accounting tools (BUSY, Vyapar) emphasize integrated billing + inventory + accounting + reporting.
- Modern expense tools (Zoho Expense/Books) provide petty cash controls, employee advances, attachments, and purchase/expense reporting.
- Procurement practice emphasizes GRN before invoice payment for quantity/quality verification.

How we use this:
- keep salary advance and reimbursement as first-class entities
- keep bills/attachments optional in v1, with reminder and missing-proof analytics
- support purchase -> process expense -> sales margin chain via cost center model
- prioritize mobile-friendly entry and month-end settlement automation

## 14) External references

- TallyPrime reimbursement pay head: https://help.tallysolutions.com/tally-prime/payroll-masters/payroll-create-reimbursement-pay-head-tally/
- TallyPrime salary advance deduction pay head: https://help.tallysolutions.com/tally-prime/payroll-masters/payroll-create-loans-and-advances-pay-head-tally/
- TallyPrime earnings pay head (updated Mar 12, 2026): https://help.tallysolutions.com/earnings-pay-head-with-calculation-type-as-attendance-payroll/
- TallyPrime job work flow: https://help.tallysolutions.com/tally/job-work-tally/?geot_debug=0
- BUSY product overview (accounting, payroll, inventory, job work): https://busy.in/
- BUSY standard edition (PO + inventory + reconciliation): https://busy.in/standard/
- Vyapar billing + inventory + reports: https://vyaparapp.in/free/billing-and-inventory-software
- Vyapar pricing/features (income, expense, purchase/sales orders, reports): https://vyaparapp.in/pricing-detail
- Zoho Expense advances: https://www.zoho.com/us/expense/help/advances/record-advance-employees/
- Zoho Expense advance vs reimbursement handling: https://www.zoho.com/us/expense/kb/admin/reimbursement/employee-advance-greater-than-reimbursable-amount/
- Zoho Expense petty cash (India): https://www.zoho.com/in/expense/help/petty-cash-accounts/petty-cash-overview/
- Zoho Books purchase order + file attachments: https://www.zoho.com/books/purchase-order
- Zoho Inventory purchase reports: https://www.zoho.com/inventory/help/reports/purchase-reports.html
- Zoho Books sales reports: https://www.zoho.com/us/books/help/reports/sales.html
- Zoho procurement GRN process (posted Mar 16, 2026): https://www.zoho.com/procurement/academy/procurement/what-is-goods-received-note-in-procurement-process-explained.html

## 15) Decision log and pending item

Confirmed decisions:
1. Salary run will be manual trigger in v1.
2. Expense approvals are not required in v1. We keep future-ready multi-level approval schema (`ExpenseApprovalPolicy`, `ExpenseApprovalStep`) for later activation.
3. Bill attachment is optional (not mandatory) in v1.
4. Non-employee payees (vendors/contractors) are out of scope for day 1 in this module's person table.
5. Salary run supports monthly payouts only in v1.
6. Advance/reimbursement impacts ledger at salary settlement time, while pending adjustments remain visible before settlement.
7. Backdated entries are allowed in v1.
8. Attachment storage is cloud-based from day 1.

Pending decision (defer to phase 4 design gate):
1. Profitability granularity: cost center only, or also invoice line/product batch.
   - Provisional v1 baseline: cost center profitability.
