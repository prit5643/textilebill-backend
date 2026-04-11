# Bill OCR Auto-Fill - Backend Plan

Date: 2026-04-09
Status: Planning only (no implementation in this document)
Owner: Codex planning artifact for future build

## 1) Goal

Enable users to upload purchase/expense bill files (image/PDF), auto-extract key fields in 5-10 seconds target time, and allow manual confirmation before saving final data.

## 2) Confirmed v1 scope

- Bill types: `purchase bills` and `expense bills`
- Input formats: `images + PDF`
- Document style: `printed English bills only`
- Extraction depth: `summary fields only` (line items deferred)
- Confirmation: mandatory user review/edit before final save
- Timeout UX requirement: if extraction exceeds expected latency, user gets `Retry` and manual entry path
- Low-confidence fields: highlighted and must be reviewed
- Vendor handling: unknown supplier -> auto-create `draft vendor` -> user confirms -> continue
- Duplicate behavior: warning shown; `Save anyway` allowed
- Tax extraction: include `GSTIN`, `CGST`, `SGST`, `IGST` when available
- Storage: cloud attachment storage from day 1

## 3) Recommended architecture

Selected approach for v1: `async extraction job + polling`.

Why:
- Better reliability vs strict sync API latency
- Cleaner timeout/retry UX
- Scales better for PDF and large images
- Easier observability and failure handling

## 4) Proposed data model

### 4.1 New enums

- `BillDocumentType`: `PURCHASE_BILL`, `EXPENSE_BILL`
- `ExtractionStatus`: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `TIMED_OUT`
- `FieldConfidence`: `HIGH`, `MEDIUM`, `LOW`, `MISSING`

### 4.2 New tables

1. `BillExtractionJob`
- `id, tenantId, companyId`
- `documentType`
- `sourceAttachmentKey`
- `status`
- `startedAt, completedAt, failedAt`
- `errorCode, errorMessage`
- `ocrProvider, modelVersion`
- `createdBy, createdAt`

2. `BillExtractionResult`
- `id, jobId`
- `vendorName, billNumber, billDate`
- `subtotal, taxAmount, totalAmount`
- `gstin, cgst, sgst, igst`
- `rawJson` (full normalized model response)
- `overallConfidence`

3. `BillExtractionField`
- `id, resultId`
- `fieldName`
- `fieldValue`
- `confidence`
- `bboxJson?` (optional coordinates for future highlight overlay)
- `isUserEdited`

4. `BillDuplicateCheck`
- `id, companyId, fingerprint`
- `vendorId?, vendorNameNorm, billNumberNorm, billDate, totalAmount`
- `linkedEntityType, linkedEntityId`

## 5) API plan

### 5.1 Upload and extraction

- `POST /bill-extraction/presign`
  - returns presigned cloud URL + object key

- `POST /bill-extraction/jobs`
  - creates extraction job against uploaded object key
  - request: `documentType`, `objectKey`, optional hint metadata
  - response: `jobId`

- `GET /bill-extraction/jobs/:jobId`
  - returns status and progress

- `GET /bill-extraction/jobs/:jobId/result`
  - returns extracted summary fields + per-field confidence

### 5.2 Vendor resolution

- `POST /bill-extraction/jobs/:jobId/vendor/resolve`
  - tries account match
  - if not matched: creates draft vendor
  - returns vendor candidate and confirmation state

### 5.3 Duplicate detection

- `POST /bill-extraction/jobs/:jobId/duplicate-check`
  - computes duplicate candidates from normalized keys
  - returns warning list; no hard block

### 5.4 Final confirmation and save

- `POST /bill-extraction/jobs/:jobId/confirm`
  - payload: user-edited fields + selected/confirmed vendor + save mode
  - validates and creates final entity (purchase/expense)

## 6) Extraction field contract (v1)

Required extraction targets:
- vendor name
- bill/invoice number
- bill date
- subtotal
- total tax
- total amount
- gstin (if present)
- cgst/sgst/igst breakup (if present)

Each returned field includes:
- value
- confidence
- normalized value
- parse warnings (if any)

## 7) Processing flow

1. User uploads image/PDF to cloud storage.
2. Frontend creates extraction job.
3. Worker processes OCR + structured extraction.
4. Frontend polls status and fetches result.
5. System runs vendor matching + draft creation when needed.
6. System runs duplicate check and returns warning.
7. User confirms/edits fields.
8. Save creates final purchase/expense record.
9. Job and result retained for audit/replay.

## 8) Timeout, retry, and fallback

- UI target: 5-10 sec expected completion for most docs
- Backend timeout policy:
  - soft timeout threshold for UX feedback
  - hard timeout marks job `TIMED_OUT`
- Retry:
  - `POST /bill-extraction/jobs/:jobId/retry`
  - max retry count configurable
- Manual fallback:
  - user can continue manual entry any time
  - uploaded attachment remains linked

## 9) Duplicate logic (v1)

Duplicate fingerprint candidate keys:
- normalized vendor name or resolved vendor id
- normalized bill number
- bill date
- total amount

Behavior:
- warning only
- user may `Save anyway`
- save is logged for audit

## 10) Security and compliance

- Validate file type and size server-side
- Cloud object keys are tenant/company scoped
- Presigned URL expiration short-lived
- No public object access by default
- PII in OCR payload minimized and encrypted in transit
- Full audit trail for extraction, edits, and final confirmation

## 11) Observability

Track metrics:
- extraction success rate
- p50/p95 extraction time
- timeout rate
- retry rate
- manual override rate
- low-confidence field rate
- duplicate warning frequency

Track structured logs:
- provider/model version
- parse errors by field
- save-anyway after duplicate warning

## 12) Test plan

Unit:
- field normalization/parsing
- gst split validation
- duplicate fingerprint function

Integration:
- upload -> job -> result -> vendor resolve -> duplicate warning -> confirm save
- timeout and retry scenarios
- draft vendor creation + confirmation path

E2E:
- printed purchase bill image autofill
- printed expense bill PDF autofill
- low-confidence correction + save

## 13) Future extensions (out of v1)

- line-item extraction
- regional-language printed bills
- handwritten bill support
- confidence heatmap overlay using bbox
- auto-suggest account/category mapping from historical patterns

## 14) Implementation notes for current product

- Keep this module decoupled from core invoice creation until confirm step
- Keep role checks minimal because v1 module has no role restrictions yet
- Ensure cloud storage integration aligns with existing attachment strategy

## 15) Final decision log for this OCR module

1. Supports purchase + expense bills in v1.
2. Extraction depth is summary-only in v1.
3. Printed English docs only in v1.
4. Supports images + PDF in v1.
5. Target response 5-10 sec; timeout/failure offers retry + manual path.
6. Low-confidence fields are highlighted for user review.
7. Unknown vendor auto-created as draft and must be confirmed.
8. Duplicate is warning only; save anyway allowed.
9. GSTIN and CGST/SGST/IGST extraction enabled when present.
10. Cloud storage from day 1.
