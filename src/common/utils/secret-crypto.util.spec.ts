import {
  decryptSecret,
  encryptSecret,
  looksEncryptedSecret,
} from './secret-crypto.util';

describe('secret-crypto util', () => {
  it('encrypts and decrypts round-trip values', () => {
    const secret = 'test-secret';
    const source = 'SensitivePassword@123';

    const encrypted = encryptSecret(source, secret);

    expect(encrypted).not.toEqual(source);
    expect(looksEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted, secret)).toBe(source);
  });

  it('returns plaintext when payload is not encrypted format', () => {
    const plain = 'plain-text';

    expect(looksEncryptedSecret(plain)).toBe(false);
    expect(decryptSecret(plain, 'anything')).toBe(plain);
  });
});
