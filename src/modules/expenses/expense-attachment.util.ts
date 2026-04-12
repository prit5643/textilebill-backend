import { createHash, randomUUID } from 'crypto';

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ATTACHMENT_MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  riff: [0x52, 0x49, 0x46, 0x46],
  webp: [0x57, 0x45, 0x42, 0x50],
} as const;

export type ExpenseAttachmentExtension = 'pdf' | 'jpg' | 'png' | 'webp';

const GENERATED_ATTACHMENT_FILENAME_PATTERN =
  /^[a-zA-Z0-9_-]+-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/i;

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

function sanitizeExpenseId(expenseId: string): string {
  const sanitized = expenseId.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || 'expense';
}

export function isAllowedExpenseMimeType(mimeType?: string): boolean {
  if (!mimeType) {
    return false;
  }

  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType.toLowerCase());
}

export function detectExpenseAttachmentExtension(
  buffer: Buffer,
): ExpenseAttachmentExtension | null {
  if (startsWithMagic(buffer, ATTACHMENT_MAGIC.pdf)) {
    return 'pdf';
  }

  if (startsWithMagic(buffer, ATTACHMENT_MAGIC.jpeg)) {
    return 'jpg';
  }

  if (startsWithMagic(buffer, ATTACHMENT_MAGIC.png)) {
    return 'png';
  }

  if (
    startsWithMagic(buffer, ATTACHMENT_MAGIC.riff) &&
    buffer.length >= 12 &&
    startsWithMagic(buffer.subarray(8, 12), ATTACHMENT_MAGIC.webp)
  ) {
    return 'webp';
  }

  return null;
}

export function buildExpenseAttachmentFilename(
  expenseId: string,
  extension: ExpenseAttachmentExtension,
): string {
  const safeExpenseId = sanitizeExpenseId(expenseId);
  return `${safeExpenseId}-${Date.now()}-${randomUUID()}.${extension}`;
}

export function isValidExpenseAttachmentFilename(filename: string): boolean {
  return GENERATED_ATTACHMENT_FILENAME_PATTERN.test(filename);
}

export function computeExpenseAttachmentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
