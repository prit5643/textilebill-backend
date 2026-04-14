import {
  PrismaClient,
  Prisma,
  SubscriptionStatus,
  PaymentStatus,
} from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330;

type SubscriptionWithPlan = {
  id: string;
  tenantId: string;
  startDate: Date;
  endDate: Date;
  status: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  amountPaid: Prisma.Decimal;
  createdAt: Date;
  plan: {
    id: string;
    price: Prisma.Decimal;
    durationDays: number;
  };
};

type Patch = Prisma.SubscriptionUpdateInput & {
  reasons: string[];
};

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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function toIstStartOfDayUtc(date: Date) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const [year, month, day] = formatted.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) -
      IST_OFFSET_MINUTES * 60 * 1000,
  );
}

function toIstEndOfDayUtc(date: Date) {
  const istStart = toIstStartOfDayUtc(date);
  return new Date(istStart.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function addIstCalendarDays(date: Date, days: number) {
  const istStart = toIstStartOfDayUtc(date);
  return new Date(istStart.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildIstSubscriptionWindow(durationDays: number, anchor = new Date()) {
  const safeDuration = Math.max(1, Math.floor(durationDays || 1));
  const startDate = toIstStartOfDayUtc(anchor);
  const endDate = toIstEndOfDayUtc(
    addIstCalendarDays(startDate, safeDuration - 1),
  );
  return { startDate, endDate };
}

function addReason(
  patchMap: Map<string, Patch>,
  row: SubscriptionWithPlan,
  patch: Prisma.SubscriptionUpdateInput,
  reason: string,
) {
  const current = patchMap.get(row.id);
  if (!current) {
    patchMap.set(row.id, {
      ...patch,
      reasons: [reason],
    });
    return;
  }

  patchMap.set(row.id, {
    ...current,
    ...patch,
    reasons: [...current.reasons, reason],
  });
}

function summarize(label: string, rows: SubscriptionWithPlan[]) {
  const now = new Date();
  const active = rows.filter((row) => row.status === SubscriptionStatus.ACTIVE);
  const activePastEnd = active.filter((row) => row.endDate < now);
  const activeFutureStart = active.filter((row) => row.startDate > now);
  const zeroAmount = rows.filter((row) => {
    const amount = Number(row.amountPaid ?? 0);
    const planPrice = Number(row.plan?.price ?? 0);
    return amount <= 0 && planPrice > 0;
  });

  const activePerTenant = new Map<string, number>();
  for (const row of active) {
    activePerTenant.set(row.tenantId, (activePerTenant.get(row.tenantId) ?? 0) + 1);
  }
  const tenantsWithMultiActive = Array.from(activePerTenant.values()).filter(
    (count) => count > 1,
  ).length;

  console.log(`\n[${label}]`);
  console.log(`- total subscriptions: ${rows.length}`);
  console.log(`- active subscriptions: ${active.length}`);
  console.log(`- active with past endDate: ${activePastEnd.length}`);
  console.log(`- active with future startDate: ${activeFutureStart.length}`);
  console.log(`- subscriptions with zero/non-positive amount but priced plan: ${zeroAmount.length}`);
  console.log(`- tenants with multiple active subscriptions: ${tenantsWithMultiActive}`);
}

async function loadSubscriptions(
  prisma: PrismaClient,
): Promise<SubscriptionWithPlan[]> {
  return prisma.subscription.findMany({
    where: { deletedAt: null },
    include: {
      plan: {
        select: {
          id: true,
          price: true,
          durationDays: true,
        },
      },
    },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'desc' }],
  });
}

function computePatches(rows: SubscriptionWithPlan[]) {
  const patchMap = new Map<string, Patch>();
  const now = new Date();
  const nowIstEnd = toIstEndOfDayUtc(now);

  // 1) Amount repair for priced plans with non-positive amount.
  for (const row of rows) {
    const amount = Number(row.amountPaid ?? 0);
    const planPrice = Number(row.plan?.price ?? 0);
    if (planPrice > 0 && amount <= 0) {
      addReason(
        patchMap,
        row,
        { amountPaid: new Prisma.Decimal(planPrice) },
        `amountPaid <= 0; set to plan price ${planPrice}`,
      );
    }
  }

  // 2) Active subscriptions already past end should be expired.
  for (const row of rows) {
    if (row.status === SubscriptionStatus.ACTIVE && row.endDate < now) {
      addReason(
        patchMap,
        row,
        { status: SubscriptionStatus.EXPIRED },
        'active subscription already past endDate',
      );
    }
  }

  // 3) Ensure at most one active subscription per tenant.
  const byTenant = new Map<string, SubscriptionWithPlan[]>();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, []);
    byTenant.get(row.tenantId)!.push(row);
  }

  for (const tenantRows of byTenant.values()) {
    const activeRows = tenantRows.filter((row) => {
      const patch = patchMap.get(row.id);
      const finalStatus =
        (patch?.status as SubscriptionStatus | undefined) ?? row.status;
      return finalStatus === SubscriptionStatus.ACTIVE;
    });

    if (activeRows.length <= 1) continue;

    activeRows.sort((a, b) => {
      if (b.createdAt.getTime() !== a.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      return b.endDate.getTime() - a.endDate.getTime();
    });

    const keeper = activeRows[0];
    for (const row of activeRows.slice(1)) {
      addReason(
        patchMap,
        row,
        {
          status: SubscriptionStatus.EXPIRED,
          endDate: nowIstEnd,
        },
        `duplicate active subscription; kept ${keeper.id}`,
      );
    }
  }

  // 4) Active subscription with future start date should start today.
  for (const row of rows) {
    const patch = patchMap.get(row.id);
    const finalStatus =
      (patch?.status as SubscriptionStatus | undefined) ?? row.status;
    if (finalStatus !== SubscriptionStatus.ACTIVE) continue;

    const finalStart = (patch?.startDate as Date | undefined) ?? row.startDate;
    if (finalStart <= now) continue;

    const window = buildIstSubscriptionWindow(row.plan.durationDays, now);
    addReason(
      patchMap,
      row,
      {
        startDate: window.startDate,
        endDate: window.endDate,
      },
      'active subscription had future startDate; normalized to current IST cycle',
    );
  }

  return patchMap;
}

async function applyPatches(prisma: PrismaClient, patchMap: Map<string, Patch>) {
  const entries = Array.from(patchMap.entries());
  if (entries.length === 0) return;

  await prisma.$transaction(
    entries.map(([id, patch]) => {
      const { reasons: _reasons, ...data } = patch;
      return prisma.subscription.update({
        where: { id },
        data,
      });
    }),
  );
}

async function main() {
  loadEnv();

  const shouldApply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const before = await loadSubscriptions(prisma);
    summarize('BEFORE', before);

    const patchMap = computePatches(before);
    const patches = Array.from(patchMap.entries());

    console.log(`\nPlanned subscription updates: ${patches.length}`);
    if (patches.length > 0) {
      for (const [id, patch] of patches.slice(0, 25)) {
        console.log(`- ${id}`);
        console.log(`  reasons: ${patch.reasons.join(' | ')}`);
      }
      if (patches.length > 25) {
        console.log(`- ... and ${patches.length - 25} more`);
      }
    }

    if (!shouldApply) {
      console.log('\nDry-run complete. Re-run with --apply to persist changes.');
      return;
    }

    await applyPatches(prisma, patchMap);
    console.log('\nApplied subscription repairs.');

    const after = await loadSubscriptions(prisma);
    summarize('AFTER', after);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('\n[repair-subscriptions] Failed:', error);
  process.exit(1);
});
