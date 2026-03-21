export const USER_AUTH_CACHE_TTL_SECONDS = 5 * 60;
export const TENANT_ACTIVE_CACHE_TTL_SECONDS = 5 * 60;
export const SUBSCRIPTION_NEGATIVE_CACHE_TTL_SECONDS = 60;
export const SUBSCRIPTION_MAX_CACHE_TTL_SECONDS = 5 * 60;

export type CachedUserAuthContext = {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  isActive: boolean;
  passwordChangedAt: string | null;
};

export function getUserAuthCacheKey(userId: string, sessionId: string) {
  return `auth:user:${userId}:session:${sessionId}`;
}

export function getUserAuthCachePattern(userId: string) {
  return `auth:user:${userId}:session:*`;
}

export function getTenantActiveCacheKey(tenantId: string) {
  return `auth:tenant-active:${tenantId}`;
}

export function getTenantSubscriptionCacheKey(tenantId: string) {
  return `auth:tenant-subscription:${tenantId}`;
}

export function parseCachedJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getActiveSubscriptionCacheTtlSeconds(
  endDate: Date,
  now = new Date(),
) {
  const secondsUntilEnd = Math.floor(
    (endDate.getTime() - now.getTime()) / 1000,
  );

  return Math.max(
    1,
    Math.min(secondsUntilEnd, SUBSCRIPTION_MAX_CACHE_TTL_SECONDS),
  );
}
