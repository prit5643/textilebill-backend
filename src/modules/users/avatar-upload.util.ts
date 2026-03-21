import { randomUUID } from 'crypto';

const ALLOWED_AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const AVATAR_MAGIC = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  gif87a: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  gif89a: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  riff: [0x52, 0x49, 0x46, 0x46],
  webp: [0x57, 0x45, 0x42, 0x50],
} as const;

export type AvatarImageExtension = 'jpg' | 'png' | 'gif' | 'webp';

const GENERATED_AVATAR_FILENAME_PATTERN =
  /^[a-zA-Z0-9_-]+-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/i;
const LEGACY_AVATAR_FILENAME_PATTERN =
  /^[a-zA-Z0-9_-]+-\d{13}\.(jpg|jpeg|png|gif|webp)$/i;

function startsWithMagic(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

function sanitizeUserId(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || 'user';
}

export function isAllowedAvatarMimeType(mimeType?: string): boolean {
  if (!mimeType) {
    return false;
  }

  return ALLOWED_AVATAR_MIME_TYPES.has(mimeType.toLowerCase());
}

export function detectAvatarImageExtension(
  buffer: Buffer,
): AvatarImageExtension | null {
  if (startsWithMagic(buffer, AVATAR_MAGIC.jpeg)) {
    return 'jpg';
  }

  if (startsWithMagic(buffer, AVATAR_MAGIC.png)) {
    return 'png';
  }

  if (
    startsWithMagic(buffer, AVATAR_MAGIC.gif87a) ||
    startsWithMagic(buffer, AVATAR_MAGIC.gif89a)
  ) {
    return 'gif';
  }

  if (
    startsWithMagic(buffer, AVATAR_MAGIC.riff) &&
    buffer.length >= 12 &&
    startsWithMagic(buffer.subarray(8, 12), AVATAR_MAGIC.webp)
  ) {
    return 'webp';
  }

  return null;
}

export function buildAvatarFilename(
  userId: string,
  extension: AvatarImageExtension,
): string {
  const safeUserId = sanitizeUserId(userId);
  return `${safeUserId}-${Date.now()}-${randomUUID()}.${extension}`;
}

export function isValidAvatarFilename(filename: string): boolean {
  return (
    GENERATED_AVATAR_FILENAME_PATTERN.test(filename) ||
    LEGACY_AVATAR_FILENAME_PATTERN.test(filename)
  );
}
