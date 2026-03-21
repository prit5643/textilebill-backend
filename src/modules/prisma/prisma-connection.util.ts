function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function redactDatabaseUrl(rawUrl: string): string {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return '<invalid-database-url>';

  if (parsed.password) {
    parsed.password = '***';
  }
  return parsed.toString();
}

export function isPgBouncerConnection(rawUrl: string): boolean {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return false;

  const usesPgBouncerFlag =
    parsed.searchParams.get('pgbouncer')?.toLowerCase() === 'true';
  const usesDefaultPgBouncerPort = parsed.port === '6432';

  return usesPgBouncerFlag || usesDefaultPgBouncerPort;
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
