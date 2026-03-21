-- Migration: add database-backed password lifecycle token table
-- Purpose: secure and scalable setup/reset token management with audit-friendly lifecycle

DO $$ BEGIN
  CREATE TYPE "PasswordTokenType" AS ENUM ('SETUP_PASSWORD', 'RESET_PASSWORD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PasswordTokenStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "PasswordLifecycleToken" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "type" "PasswordTokenType" NOT NULL,
  "status" "PasswordTokenStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "maxResends" INTEGER NOT NULL DEFAULT 3,
  "requestedByRole" TEXT,
  "requestedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordLifecycleToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordLifecycleToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PasswordLifecycleToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordLifecycleToken_tokenHash_key"
  ON "PasswordLifecycleToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "PasswordLifecycleToken_userId_type_status_idx"
  ON "PasswordLifecycleToken"("userId", "type", "status");

CREATE INDEX IF NOT EXISTS "PasswordLifecycleToken_tenantId_status_expiresAt_idx"
  ON "PasswordLifecycleToken"("tenantId", "status", "expiresAt");

CREATE INDEX IF NOT EXISTS "PasswordLifecycleToken_expiresAt_idx"
  ON "PasswordLifecycleToken"("expiresAt");

CREATE INDEX IF NOT EXISTS "PasswordLifecycleToken_createdAt_idx"
  ON "PasswordLifecycleToken"("createdAt");
