# TextileBill Backend — Copilot & Codex Instructions
# Applies to: GitHub Copilot, Codex, all AI agents
# Last updated: 2026-04-15

## ⛔ Core Agent Rules (Apply to All Tasks)

1. **No hallucinations** — Never invent field names, enum values, or Prisma model relations. Check `schema.prisma` first.
2. **No assumptions** — If a requirement is unclear, ask. Do not guess and implement.
3. **Read before write** — View the service file, the DTO, and `schema.prisma` before making any changes.
4. **No silent failures** — Every error must throw a typed NestJS exception. Never empty `catch {}`.
5. **No placeholder code** — Do not write stub services or `TODO` functions and call the task done.
6. **Tenant isolation always** — Every query must include `companyId` in `where`.

---

## Project Stack

- **Framework**: NestJS + Express
- **Database**: PostgreSQL via Prisma ORM (`prisma/schema.prisma`)
- **Cache**: Redis via `RedisService` module
- **Auth**: JWT (`JwtAuthGuard`) + Company access (`CompanyAccessGuard`)
- **Validation**: `class-validator` + `class-transformer`, `ValidationPipe` (global, whitelist mode)

---

## Must-Follow Rules

### CORS
```ts
// ✅ Explicit allowlist from config
// ❌ Never: origin: true  or  origin: '*'
```
Allowed origins come from `ALLOWED_ORIGINS` env var → `app.allowedOrigins` config key.

### DTO Validation — Always bound numeric fields
```ts
@IsNumber() @Min(0.01) @Max(10_000_000) amount: number;
@IsNumber() @Min(0) quantity: number;
@IsNumber() @Min(0) rate: number;
```
Never leave a numeric DTO field without `@Min` and `@Max`.

### Prisma Enum Alignment
- Valid `InvoiceStatus` values: `ACTIVE`, `CANCELLED`, `DRAFT`.
- `PAID` and `PARTIALLY_PAID` do NOT exist in the DB. Never add them to enums.
- Before adding any enum value, verify it exists in `schema.prisma`.

### Aggregations — Never Load into Memory
```ts
// ✅ Use Prisma aggregate / groupBy / $queryRaw
// ❌ Never: const all = await prisma.model.findMany(); all.reduce(...);
```

### Currency Rounding
```ts
private round2(value: number) { return Math.round(value * 100) / 100; }
// totalAmount = round2(taxableAmount + taxAmount) — never: subTotal - discount + tax
```

### Transactions
Use `$transaction()` for any operation that writes to multiple tables atomically.

### Ledger Markers
Narration for invoice payments must contain `[INVOICE_PAYMENT]`. This string is used by `findAll()` to aggregate `paidAmount`. Never change or remove it.

### paidAmount in findAll()
`InvoiceService.findAll()` appends `paidAmount` via `ledgerEntry.groupBy`. Do not remove this. Frontend depends on it.

### getSummary()
Must use `$queryRaw` with LEFT JOIN for outstanding balance. Never use `findMany().reduce()`.

### Error Handling
```ts
// ✅ Specific, informative exceptions
throw new NotFoundException(`Invoice "${id}" not found.`);
throw new BadRequestException('Payment exceeds outstanding balance.');
throw new ConflictException('SKU already exists.');

// ❌ Never
throw new Error('failed');
return null; // silent failure
```

### Pagination
- Always use `parsePagination()` from `common/utils/pagination.util`.
- Always return `createPaginatedResult()` from list endpoints.
- Never return unbounded arrays. Always include `take` and `skip` in `findMany()`.

### Security
- Always verify `companyId` ownership before returning or modifying any entity.
- Never log passwords, tokens, OTPs, or user PII.
- Use `Prisma.sql` template literals in `$queryRaw` — never string concatenation (SQL injection).

### Controller Pattern
```ts
// Controllers contain NO business logic — only route handling
@Get(':id')
async findOne(@Param('id') id: string, @GetCompany() company: Company) {
  return this.invoiceService.findOne(company.id, id); // ← delegate to service
}
```

### Business Guards
- Stock: validate available stock >= requested quantity before reducing.
- Payment: validate payment amount <= outstanding balance.
- Financial year: validate year exists and is not locked before writing.

### Performance
- Add DB indexes for all frequently-queried fields in `schema.prisma`.
- Never run queries inside loops (N+1 problem). Batch with `include`, `findMany({ where: { id: { in: ids } } })`.
- Cache slow-changing summaries in Redis with appropriate TTL.
