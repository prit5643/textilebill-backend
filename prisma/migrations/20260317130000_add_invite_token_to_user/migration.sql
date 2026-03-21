-- Migration: Add invite token fields to User
-- Purpose: Support admin-initiated user onboarding via email invite link

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "inviteToken"          TEXT,
  ADD COLUMN IF NOT EXISTS "inviteTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_inviteToken_key"
  ON "User"("inviteToken");
