# Work Orders Backend Handover (Deferred Feature)

Date: 2026-04-12  
Branch target: `add-expense-feature`  
Status: Documented only (feature intentionally not active on this branch)

## 1) Why this doc exists

Work-order (outsourced capacity + margin tracking) backend work was explored but intentionally deferred because:
- current deployment priority is bug-fix stability
- feature was not finished end-to-end
- shipping partial implementation would increase deployment risk

This handover doc captures exactly how to add it later with predictable behavior.

## 2) Target v1 scope (backend)

Implement a new `work-order` domain with:
1. work order creation and listing
2. lot split (`IN_HOUSE` / `OUTSOURCED`) with mismatch warning + override reason
3. strict invoice links:
- one final sale invoice per work order
- one purchase invoice per outsourced lot
4. loss incident tracking
5. auto-adjustment lifecycle (`PENDING`, `POSTED`, `FAILED`, `REVERSED`)
6. work-order reporting endpoints under `/reports/work-orders/*`

## 3) API contract to implement

## 3.1 Work orders
- `POST /work-orders`
- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders/:id/split`
- `POST /work-orders/:id/close`

## 3.2 Invoice linking
- `POST /work-orders/:id/invoices/link-sale`
- `POST /work-orders/lots/:lotId/invoices/link-purchase`

## 3.3 Loss and adjustment
- `POST /work-orders/:id/loss-incidents`
- `GET /work-orders/:id/loss-incidents`
- `POST /work-orders/loss-incidents/:id/retry-adjustment`
- `POST /work-orders/loss-incidents/:id/reverse`

## 3.4 Profit and reports
- `GET /work-orders/:id/profitability`
- `GET /reports/work-orders/monthly-profit-summary?from=YYYY-MM&to=YYYY-MM`
- `GET /reports/work-orders/vendor-margin-risk?from=YYYY-MM&to=YYYY-MM`
- `GET /reports/work-orders/profitability/:id`

## 4) Data model blueprint (Prisma)

## 4.1 Enums
- `WorkOrderStatus`
- `WorkOrderLotType`
- `WorkOrderLotStatus`
- `WorkOrderInvoiceLinkType`
- `WorkOrderLossReasonCode`
- `WorkOrderLossChargeTo`
- `WorkOrderAutoAdjustMode`
- `WorkOrderLossIncidentStatus`
- `WorkOrderAdjustmentType`
- `WorkOrderAdjustmentStatus`

## 4.2 Models
- `WorkOrder`
- `WorkOrderLot`
- `WorkOrderInvoiceLink`
- `WorkOrderLossIncident`
- `WorkOrderAutoAdjustment`

## 4.3 Key constraints
1. `WorkOrder`: unique `(companyId, orderRef)`
2. `WorkOrderInvoiceLink`: enforce one sale link per work order
3. `WorkOrderInvoiceLink`: enforce one purchase link per outsourced lot
4. `WorkOrderAutoAdjustment`: one active adjustment per incident
5. all entities strictly scoped by `tenantId + companyId`

## 5) Suggested file structure

Create:
- `src/modules/work-order/work-order.module.ts`
- `src/modules/work-order/work-order.controller.ts`
- `src/modules/work-order/work-order.service.ts`
- `src/modules/work-order/work-order.service.spec.ts`
- `src/modules/work-order/dto/*`

Update:
- `src/app.module.ts` (register module)
- `src/modules/report/report.controller.ts` (work-order report routes)
- `src/modules/report/report.module.ts` (import `WorkOrderModule`)

## 6) Business rules to enforce in service layer

1. Split qty mismatch is warning path, not hard block:
- reject only if mismatch and no `overrideReason`

2. Outsourced lot requires:
- `vendorAccountId`
- `agreedRate`

3. Invoice linking:
- sale link must reference `InvoiceType.SALE`
- purchase link must reference `InvoiceType.PURCHASE`
- company mismatch is hard block

4. Loss incident:
- amount > 0
- reason required
- auto-adjust mode derived from `chargeTo`

5. Close work order:
- requires all lots closed
- or `overrideReason` for force-close

## 7) Auto-adjustment behavior matrix

1. `chargeTo=VENDOR`
- preferred: `PURCHASE_RETURN` against linked purchase invoice
- fallback: `LOSS_EXPENSE_NOTE` if purchase invoice is missing

2. `chargeTo=CUSTOMER`
- preferred: `SALE_RETURN` against linked final sale invoice
- fallback: `LOSS_EXPENSE_NOTE` if sale invoice is missing

3. `chargeTo=OUR_COMPANY`
- always `LOSS_EXPENSE_NOTE`

4. Retry
- allow retry only when adjustment is `FAILED`

5. Reverse
- allow reverse only when adjustment is `POSTED`

## 8) Test plan (backend)

## 8.1 Unit tests
1. split mismatch requires override reason
2. one sale invoice link rule
3. one purchase invoice per outsourced lot rule
4. incident chargeTo mapping to adjustment mode/type
5. profitability formula checks

## 8.2 Integration/API tests
1. create/list/detail work order
2. split success + split warning path
3. link conflict (`409`) paths
4. loss incident create + adjustment post/fail/retry
5. reverse adjustment path
6. cross-company access rejection

## 8.3 Regression tests
1. invoice module tests
2. reports module tests
3. auth/company scoping tests

## 9) Implementation sequence (safe order)

1. Add Prisma schema (enums/models/relations)
2. `npx prisma validate` + `npx prisma generate`
3. Create module/controller/service/DTOs
4. Wire into `app.module.ts`
5. Add report route integration
6. Add unit tests
7. Add integration tests
8. Build/typecheck/test gate

## 10) Migration and deployment runbook

When feature is resumed:
1. create migration in interactive local dev:
- `npx prisma migrate dev --name add_work_orders_module`
2. verify:
- `npx prisma validate --schema prisma/schema.prisma`
- `npx prisma generate --schema prisma/schema.prisma`
- `npx tsc --noEmit`
3. deploy migration:
- `npx prisma migrate deploy`
4. deploy app and monitor logs for:
- work-order endpoints
- report endpoints
- adjustment failures

## 11) Rollback strategy

If post-deploy issue appears:
1. disable frontend entry points for work orders
2. block write routes with temporary feature flag guard
3. keep tables intact (no destructive rollback in production)
4. release patch for logic; avoid emergency schema drop

## 12) Notes about previous partial implementation

A previous experimental implementation was intentionally removed from `add-expense-feature` to keep deployment safe.

Important:
- do not blindly cherry-pick mixed historical commits
- re-introduce feature by following this file’s sequence
- validate each step with tests before merging

---

This document is the backend source of truth for re-introducing work-order functionality safely later.
