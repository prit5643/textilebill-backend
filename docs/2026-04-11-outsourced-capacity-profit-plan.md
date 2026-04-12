# Outsourced Capacity + Profitability Backend Plan (Full-Proof, No Implementation)

Date: 2026-04-12  
Branch Context: `add-expense-feature`  
Document Type: Planning only

## 1) Purpose

Design a robust backend module to manage outsourced overflow work, invoice-linked margins, and loss-adjusted profitability without shipping partial behavior.

## 2) Product Rules (Locked)

1. Track outsourced cost only in v1 (no in-house cost model).
2. One final customer sale invoice per work order.
3. One vendor purchase invoice per outsourced lot.
4. Loss incidents auto-adjust financial position.
5. Quantity mismatch is warning + manual override with mandatory reason.
6. Analytics priority: monthly profit summary and vendor-wise margin/risk.

## 3) Scope

### In scope (v1)

- Work order lifecycle management.
- Lot splitting with outsourced vendor assignment.
- Invoice linking constraints.
- Loss incident recording and adjustment lifecycle tracking.
- Work-order profitability reporting endpoints.

### Out of scope (v1)

- In-house processing cost allocation.
- Partial sale invoice dispatch model.
- Multiple purchase invoices per single outsourced lot.
- Automated vendor recommendation engine.

## 4) Domain Design

## 4.1 Core entities

- `WorkOrder`
- `WorkOrderLot`
- `WorkOrderInvoiceLink`
- `WorkOrderLossIncident`
- `WorkOrderAutoAdjustment`

## 4.2 Key relationships

- `WorkOrder` belongs to `Company` and customer `Account`.
- `WorkOrderLot` belongs to `WorkOrder` and optional vendor `Account`.
- `WorkOrderInvoiceLink` binds `Invoice` to work-order economics.
- `WorkOrderLossIncident` captures quantified operational loss.
- `WorkOrderAutoAdjustment` captures financial adjustment lifecycle tied to one incident.

## 4.3 Constraint goals

1. Unique `orderRef` per company.
2. Exactly one sale link per work order.
3. Exactly one purchase link per outsourced lot.
4. One active adjustment lifecycle per loss incident.
5. Strict tenant/company scoping on all reads/writes.

## 5) API Plan

## 5.1 Work orders

- `POST /work-orders`
- `GET /work-orders`
- `GET /work-orders/:id`
- `POST /work-orders/:id/split`
- `PATCH /work-orders/:id/close`

## 5.2 Invoice linking

- `POST /work-orders/:id/link-sale-invoice`
- `POST /work-orders/:id/link-purchase-invoice`

## 5.3 Loss and adjustments

- `POST /work-orders/:id/loss-incidents`
- `POST /work-orders/loss-incidents/:incidentId/retry`
- `POST /work-orders/loss-incidents/:incidentId/reverse`

## 5.4 Reporting

- `GET /work-orders/:id/profitability`
- `GET /reports/monthly-profit-summary?year=YYYY[&month=MM]`
- `GET /reports/vendor-margin-risk`

## 6) Validation Plan

1. Split validation:
- total lot qty mismatch -> warning path
- mismatch requires override reason

2. Lot validation:
- outsourced lot requires vendor and agreed rate
- accepted + rejected cannot exceed produced

3. Invoice link validation:
- sale link requires `InvoiceType.SALE`
- purchase link requires `InvoiceType.PURCHASE`
- cross-company link is blocked
- duplicate link rule is blocked

4. Loss validation:
- amount > 0
- reason code + reason note required
- charge target required

5. Close validation:
- all lots closed OR override reason required

## 7) Auto-Adjustment Rule Plan

1. `chargeTo=VENDOR`
- preferred: payable reduction against linked purchase invoice
- fallback: direct loss note when purchase invoice is not linked

2. `chargeTo=CUSTOMER`
- preferred: receivable reduction against linked sale invoice
- fallback: direct loss note when sale invoice is not linked

3. `chargeTo=OUR_COMPANY`
- direct loss note

4. Retry/reverse governance
- retry only for `FAILED`
- reverse only for `POSTED`
- every transition must be auditable

## 8) Security and Reliability Plan

1. Company and tenant scoping in every query.
2. RBAC on all mutating endpoints.
3. Override actions store user, timestamp, and reason.
4. Idempotency protection for mutation retries.
5. Stable error envelope (`code`, `message`, `traceId`, field-level details).

## 9) Reporting Formula Plan

- `NetRevenue = sale invoice total - customer reductions`
- `NetOutsourceCost = purchase invoice total - vendor reductions`
- `DirectLoss = incidents charged to OUR_COMPANY`
- `Contribution = NetRevenue - NetOutsourceCost - DirectLoss`

Vendor risk plan includes:
- assigned qty
- accepted/rejected ratio
- vendor-linked loss amount
- margin contribution proxy
- risk bucket (`LOW`, `MEDIUM`, `HIGH`)

## 10) Test Strategy Plan

## Unit tests

- split warning behavior
- invoice link constraints
- adjustment mode mapping
- profitability formulas

## API integration tests

- create/list/detail/split/close flows
- conflict paths (duplicate links)
- loss incident + retry + reverse
- cross-company rejection

## Regression tests

- invoice module
- report module
- auth/scope guards

## 11) Rollout Plan

1. Add DB schema/migration only when feature is approved for implementation.
2. Behind a feature flag for pilot companies.
3. Monitor:
- adjustment failure rate
- override usage rate
- invoice link conflict frequency
4. Expand rollout after pilot stability window.

## 12) Exit Criteria

Plan is considered implementation-ready when:
1. schema + API + validation + reporting contracts are frozen,
2. test matrix is approved,
3. rollback strategy is reviewed,
4. frontend dependency contract is accepted.

---

This file is intentionally planning-only and suitable as a future implementation source-of-truth.
