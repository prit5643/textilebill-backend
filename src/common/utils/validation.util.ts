export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/;

// Accept either strict E.164 (+<countrycode><number>) or standard Indian 10-digit mobile.
export const MOBILE_REGEX = /^(\+[1-9]\d{7,14}|[6-9]\d{9})$/;

export function normalizeUppercase(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

export function normalizePhone(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
