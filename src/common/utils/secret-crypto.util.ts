import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const AES_ALGO = 'aes-256-gcm';

type SecretParts = {
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
};

function buildKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function parseEncryptedSecret(payload: string): SecretParts | null {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return {
      iv: Buffer.from(parts[0], 'base64'),
      tag: Buffer.from(parts[1], 'base64'),
      data: Buffer.from(parts[2], 'base64'),
    };
  } catch {
    return null;
  }
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const key = buildKey(secret);
  const cipher = createCipheriv(AES_ALGO, key, iv);

  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(value: string, secret: string): string {
  const parsed = parseEncryptedSecret(value);
  if (!parsed) {
    return value;
  }

  const key = buildKey(secret);
  const decipher = createDecipheriv(AES_ALGO, key, parsed.iv);
  decipher.setAuthTag(parsed.tag);

  const decoded = Buffer.concat([decipher.update(parsed.data), decipher.final()]);
  return decoded.toString('utf8');
}

export function looksEncryptedSecret(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return parseEncryptedSecret(value) !== null;
}
