# TextileBill — Issue Tracker
**Last audit:** 2026-04-15 | **Scope:** Full-stack (Frontend + Backend)  
**Status:** All critical and high-priority issues resolved ✅

---

## Open Issues

| # | Issue | Severity | Category | File |
|---|-------|----------|----------|------|
| 40 | No `AbortController` cleanup on unmount in data hooks | 🟡 Medium | Memory / Tech Debt | Multiple hooks in `lib/hooks/` |

> **#40 context:** No active memory leaks observed in production. Accepted as low-urgency tech debt. Implement when refactoring a hook for another reason.

---

## Completed Sprint Summary (2026-04-15)

42 issues identified and resolved across 2 audits. Key areas:

### 🔴 Critical (Fixed)
- `paidAmount` hardcoded to `0` on invoice list — now aggregated server-side via `ledgerEntry.groupBy`
- Payment totals showing wrong field (`p.amount` → `p.credit`)
- CORS set to wildcard `origin: true` — replaced with explicit allowlist
- `RecordPaymentDto` missing `@Max` — overpayment now blocked server-side
- `computeTotals()` rounding formula corrected (`taxableAmount + taxAmount`)
- `getSummary()` loading all invoices into memory — replaced with `$queryRaw`

### 🟠 High (Fixed)
- All `window.confirm()` / `confirm()` dialogs replaced with `<Dialog>` components (8 instances across 4 files)
- Auth session gate causing double `/auth/me` network calls
- All 5 accounting tabs mounting simultaneously — lazy mounting implemented
- Print popup blocked by browsers — now awaits PDF fetch before `window.open()`
- `refetchOnWindowFocus` globally disabled to prevent cascade API calls

### 🟡 Medium (Fixed)
- Currency formatter (`fmt`/`formatINR`) duplicated across 6 files — centralized to `@/lib/format-currency.ts`
- `Math.random()` used as React keys in day book reports
- `InvoiceStatusEnum` contained `PAID`/`PARTIALLY_PAID` (not in DB schema)
- `@Min(0)` added to all unbounded numeric DTO fields
- Mobile loading returned `null` instead of skeleton components
- `useStockReport` missing `staleTime`

---

## Agent Rules

Rules for all AI agents (Antigravity, Copilot, Codex, Cursor) are maintained in:

| File | Applies to |
|------|-----------|
| `textilebill-frontend/.cursorrules` | Cursor, Windsurf, Antigravity |
| `textilebill-frontend/.github/copilot-instructions.md` | GitHub Copilot, Codex |
| `textilebill-backend/.cursorrules` | Cursor, Windsurf, Antigravity |
| `textilebill-backend/.github/copilot-instructions.md` | GitHub Copilot, Codex |

**Any agent working on this codebase must read the relevant rules file before making any changes.**
