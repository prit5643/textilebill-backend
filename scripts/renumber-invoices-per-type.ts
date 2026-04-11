/**
 * One-time migration: Renumber all existing invoices per-type.
 *
 * Previously, all invoice types shared one global counter (SALE sequence).
 * This caused PURCHASE invoice #7 even though it was the first PURCHASE.
 *
 * Uses Prisma $queryRaw tagged templates (compatible with pgbouncer pooler).
 *
 * Run: npx ts-node scripts/renumber-invoices-per-type.ts
 * Safe to re-run — idempotent.
 */

import { PrismaClient, Prisma, VoucherType } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf('=');
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim();
    let val = trimmed.slice(sep + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function getDirectUrl(): string {
  const poolUrl = process.env.DATABASE_URL ?? '';
  // Convert Supabase pooler URL (port 6543) to direct connection (port 5432)
  try {
    const parsed = new URL(poolUrl);
    if (parsed.hostname.endsWith('.pooler.supabase.com')) {
      parsed.port = '5432';
      // Remove pgbouncer params
      parsed.searchParams.delete('pgbouncer');
      parsed.searchParams.delete('connection_limit');
      return parsed.toString();
    }
  } catch {
    // ignore parse error — fall through
  }
  return poolUrl;
}

function invoiceTypeToVoucherType(type: string): VoucherType {
  switch (type) {
    case 'PURCHASE':        return VoucherType.PURCHASE;
    case 'SALE_RETURN':     return VoucherType.SALE_RETURN;
    case 'PURCHASE_RETURN': return VoucherType.PURCHASE_RETURN;
    default:                return VoucherType.SALE;
  }
}

async function rawUpdate(prisma: PrismaClient, invoiceNumber: string, id: string) {
  // Use tagged template literal — works with pgbouncer (no prepared statements)
  await prisma.$queryRaw`UPDATE "Invoice" SET "invoiceNumber" = ${invoiceNumber} WHERE "id" = ${id}`;
}

async function main() {
  loadEnv();

  const directUrl = getDirectUrl();
  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });

  console.log('\nConnecting to DB...');

  try {
    // 1. Load all non-deleted invoices ordered by date → createdAt
    const allInvoices = await prisma.invoice.findMany({
      where: { deletedAt: null },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        companyId: true,
        financialYearId: true,
        type: true,
        invoiceNumber: true,
        tenantId: true,
      },
    });

    console.log(`Found ${allInvoices.length} active invoices.\n`);
    if (allInvoices.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // 2. Group by (companyId, financialYearId, type)
    const groups = new Map<string, typeof allInvoices>();
    for (const inv of allInvoices) {
      const key = `${inv.companyId}|${inv.financialYearId}|${inv.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inv);
    }

    console.log(`Grouped into ${groups.size} type-buckets.\n`);

    // 3. Build the renumbering plan
    const plan: Array<{ id: string; oldNumber: string; newNumber: string; type: string }> = [];
    for (const [key, invoices] of groups.entries()) {
      const [,, invoiceType] = key.split('|');
      console.log(`── ${invoiceType} (${invoices.length} invoices)`);
      let counter = 1;
      for (const inv of invoices) {
        const newNumber = String(counter);
        plan.push({ id: inv.id, oldNumber: inv.invoiceNumber, newNumber, type: invoiceType });
        const changed = inv.invoiceNumber !== newNumber;
        console.log(`   ${inv.invoiceNumber} → ${newNumber}${changed ? '' : ' (no change)'}`);
        counter++;
      }
    }

    const needsUpdate = plan.filter((p) => p.oldNumber !== p.newNumber);
    if (needsUpdate.length === 0) {
      console.log('\n✅ All invoices already correctly numbered. Nothing to do.\n');
      return;
    }

    console.log(`\n${needsUpdate.length} invoice(s) need renumbering.\n`);

    // 4. Two-pass raw SQL update
    // Pass 1: set to a temp value so we don't break the unique constraint while swapping
    console.log('Pass 1: Assigning temp numbers...');
    for (const { id } of needsUpdate) {
      const tempNum = `RENUMBER-${id.slice(0, 8)}`;
      await rawUpdate(prisma, tempNum, id);
    }
    console.log('  Done.\n');

    // Pass 2: assign final numbers
    console.log('Pass 2: Assigning final numbers...');
    for (const { id, oldNumber, newNumber, type } of needsUpdate) {
      await rawUpdate(prisma, newNumber, id);
      console.log(`  [${type}] #${oldNumber} → #${newNumber}`);
    }
    console.log('  Done.\n');

    // 5. Update VoucherSequence counters
    console.log('Updating VoucherSequence counters...');
    for (const [key, invoices] of groups.entries()) {
      const [companyId, financialYearId, invoiceType] = key.split('|');
      const { tenantId } = invoices[0];
      const maxNumber = invoices.length;
      const voucherType = invoiceTypeToVoucherType(invoiceType);

      await prisma.voucherSequence.upsert({
        where: { companyId_financialYearId_type: { companyId, financialYearId, type: voucherType } },
        update: { currentValue: maxNumber },
        create: { tenantId, companyId, financialYearId, type: voucherType, prefix: '', currentValue: maxNumber },
      });

      console.log(`  [${invoiceType}] sequence = ${maxNumber} (next auto # = ${maxNumber + 1})`);
    }

    console.log(`\n✅ Done. Renumbered ${needsUpdate.length} invoice(s) across ${groups.size} type-buckets.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
