ALTER TABLE "RefreshToken"
ADD COLUMN "deviceId" TEXT,
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE INDEX "RefreshToken_userId_revokedAt_expiresAt_idx"
ON "RefreshToken"("userId", "revokedAt", "expiresAt");
