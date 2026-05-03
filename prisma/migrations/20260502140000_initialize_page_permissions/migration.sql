-- Initialize pagePermissions for all UserCompany records that don't have them set
-- This ensures users have access to all pages permitted by their role
UPDATE "UserCompany" 
SET "pagePermissions" = NULL 
WHERE "pagePermissions" IS NOT NULL AND "pagePermissions"::text = '{}';

-- Add an index on pagePermissions for faster lookups in the future
CREATE INDEX IF NOT EXISTS "UserCompany_pagePermissions_idx" ON "UserCompany" USING GIN("pagePermissions");
