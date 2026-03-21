import { createHash, randomUUID } from 'crypto';

export function generatePasswordLifecycleToken(): string {
  return randomUUID();
}

export function hashPasswordLifecycleToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
