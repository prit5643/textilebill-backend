ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtpPurpose') THEN
    CREATE TYPE "OtpPurpose" AS ENUM (
      'LOGIN',
      'VERIFY_EMAIL',
      'VERIFY_WHATSAPP',
      'PASSWORD_RESET'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtpDeliveryChannel') THEN
    CREATE TYPE "OtpDeliveryChannel" AS ENUM ('EMAIL', 'WHATSAPP');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "OtpChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "OtpPurpose" NOT NULL,
  "requestedChannel" "OtpDeliveryChannel" NOT NULL,
  "deliveredChannel" "OtpDeliveryChannel" NOT NULL,
  "targetIdentifier" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OtpChallenge_userId_fkey'
  ) THEN
    ALTER TABLE "OtpChallenge"
    ADD CONSTRAINT "OtpChallenge_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "OtpChallenge_userId_purpose_verifiedAt_idx"
  ON "OtpChallenge"("userId", "purpose", "verifiedAt");

CREATE INDEX IF NOT EXISTS "OtpChallenge_expiresAt_idx"
  ON "OtpChallenge"("expiresAt");
