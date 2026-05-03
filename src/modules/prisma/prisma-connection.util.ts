function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSupabasePoolerHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.pooler.supabase.com');
}

export function redactDatabaseUrl(rawUrl: string): string {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return '<invalid-database-url>';

  if (parsed.password) {
    parsed.password = '***';
  }
  return parsed.toString();
}

export function normalizeDatabaseUrl(rawUrl: string): string {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) {
    return rawUrl;
  }

  if (!isSupabasePoolerHost(parsed.hostname)) {
    return rawUrl;
  }

  if (parsed.searchParams.get('pgbouncer')?.toLowerCase() !== 'true') {
    parsed.searchParams.set('pgbouncer', 'true');
  }

  const connectionLimit = parsed.searchParams.get('connection_limit');
  const parsedLimit = connectionLimit
    ? Number.parseInt(connectionLimit, 10)
    : NaN;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    // Default to 5 connections when no valid limit is configured.
    // Using 1 is too aggressive and causes pool exhaustion under normal concurrency.
    parsed.searchParams.set('connection_limit', '5');
  }

  return parsed.toString();
}

export function isPgBouncerConnection(rawUrl: string): boolean {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return false;

  const usesPgBouncerFlag =
    parsed.searchParams.get('pgbouncer')?.toLowerCase() === 'true';
  const usesDefaultPgBouncerPort = parsed.port === '6432';
  const usesSupabasePooler = isSupabasePoolerHost(parsed.hostname);

  return usesPgBouncerFlag || usesDefaultPgBouncerPort || usesSupabasePooler;
}

export function hasConnectionLimit(rawUrl: string): boolean {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return false;

  const value = parsed.searchParams.get('connection_limit');
  if (!value) return false;

  const parsedLimit = Number.parseInt(value, 10);
  return Number.isFinite(parsedLimit) && parsedLimit > 0;
}

export function getRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponent = Math.max(0, attempt - 1);
  const computed = baseDelayMs * 2 ** exponent;
  return Math.min(maxDelayMs, computed);
}
