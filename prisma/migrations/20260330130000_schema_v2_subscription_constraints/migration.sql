-- Schema v2 alignment + subscription hardening
-- This migration is intentionally idempotent to support environments where
-- parts of schema-v2 were applied manually before migration history cleanup.

-- 1) Add missing enums for plan/subscription domain
DO $$
BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Tenant slug is required by schema-v2 and runtime
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "slug" TEXT;

UPDATE "Tenant"
SET "slug" = LOWER(
  REGEXP_REPLACE(TRIM(COALESCE("name", 'tenant')), '[^a-zA-Z0-9]+', '-', 'g')
) || '-' || SUBSTRING("id" FROM 1 FOR 8)
WHERE "slug" IS NULL OR BTRIM("slug") = '';

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "slug"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Tenant"
  WHERE "slug" IS NOT NULL AND BTRIM("slug") <> ''
)
UPDATE "Tenant" t
SET "slug" = t."slug" || '-' || SUBSTRING(t."id" FROM 1 FOR 8)
FROM ranked r
WHERE t."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant" ("slug");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Tenant"
    WHERE "slug" IS NULL OR BTRIM("slug") = ''
  ) THEN
    RAISE EXCEPTION 'Tenant.slug contains NULL/empty values after backfill';
  END IF;
END $$;

ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;

-- 3) Prisma upserts rely on userId+companyId unique selector
DROP INDEX IF EXISTS "UserCompany_tenantId_userId_companyId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UserCompany_userId_companyId_key"
  ON "UserCompany" ("userId", "companyId");

-- 4) Party model no longer contains companyId in schema-v2
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Party'
      AND column_name = 'companyId'
  ) THEN
    ALTER TABLE "Party" DROP CONSTRAINT IF EXISTS "Party_companyId_tenantId_fkey";
    DROP INDEX IF EXISTS "Party_tenantId_companyId_idx";
    DROP INDEX IF EXISTS "Party_email_deletedAt_companyId_key";
    DROP INDEX IF EXISTS "Party_phone_deletedAt_companyId_key";
    DROP INDEX IF EXISTS "Party_companyId_lower_gstin_active_key";
    ALTER TABLE "Party" DROP COLUMN "companyId";
  END IF;
END $$;

DROP INDEX IF EXISTS "Party_companyId_lower_gstin_active_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Party_tenantId_lower_gstin_active_key"
  ON "Party" ("tenantId", LOWER("gstin"))
  WHERE "gstin" IS NOT NULL AND "deletedAt" IS NULL;

-- 5) Keep legacy VoucherSequence.updatedAt insert-safe for existing DBs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'VoucherSequence'
      AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "VoucherSequence"
      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- 6) Create Plan + Subscription structures if missing
CREATE TABLE IF NOT EXISTS "Plan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10,2) NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "maxUsers" INTEGER NOT NULL DEFAULT 0,
  "maxCompanies" INTEGER NOT NULL DEFAULT 0,
  "features" JSONB,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
  "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_name_key" ON "Plan" ("name");
CREATE INDEX IF NOT EXISTS "Subscription_tenantId_idx" ON "Subscription" ("tenantId");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription" ("planId");
CREATE INDEX IF NOT EXISTS "Subscription_status_endDate_idx" ON "Subscription" ("status", "endDate");

-- 7) Data cleanup + DB-level safety for one-active-subscription rule
UPDATE "Subscription"
SET "status" = 'EXPIRED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND "status" = 'ACTIVE'
  AND "endDate" < CURRENT_TIMESTAMP;

WITH ranked_active AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId"
      ORDER BY "endDate" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "Subscription"
  WHERE "deletedAt" IS NULL
    AND "status" = 'ACTIVE'
)
UPDATE "Subscription" s
SET "status" = 'EXPIRED',
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_active r
WHERE s."id" = r."id"
  AND r.rn > 1;

CREATE INDEX IF NOT EXISTS "Subscription_tenant_status_endDate_active_idx"
  ON "Subscription" ("tenantId", "status", "endDate")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_single_active_tenant_key"
  ON "Subscription" ("tenantId")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

DO $$
BEGIN
  ALTER TABLE "Plan"
    ADD CONSTRAINT "chk_plan_price_non_negative"
    CHECK ("price" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Plan"
    ADD CONSTRAINT "chk_plan_duration_positive"
    CHECK ("durationDays" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Plan"
    ADD CONSTRAINT "chk_plan_duration_allowed"
    CHECK ("durationDays" IN (30, 90, 180)) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Plan"
    ADD CONSTRAINT "chk_plan_limits_non_negative"
    CHECK ("maxUsers" >= 0 AND "maxCompanies" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "chk_subscription_date_window"
    CHECK ("endDate" > "startDate");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "chk_subscription_amount_non_negative"
    CHECK ("amountPaid" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
