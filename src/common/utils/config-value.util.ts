export function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export type TrustProxySetting = boolean | number | string | string[];

export function parseTrustProxySetting(
  value: unknown,
  fallback: TrustProxySetting,
): TrustProxySetting {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsedBoolean = parseBooleanFlag(trimmed);
  if (parsedBoolean !== undefined) {
    return parsedBoolean;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (trimmed.includes(',')) {
    const values = trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }

  return trimmed;
}
