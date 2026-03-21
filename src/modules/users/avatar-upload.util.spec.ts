import {
  buildAvatarFilename,
  detectAvatarImageExtension,
  isAllowedAvatarMimeType,
  isValidAvatarFilename,
} from './avatar-upload.util';

describe('avatar-upload.util', () => {
  it('accepts only supported avatar mime types', () => {
    expect(isAllowedAvatarMimeType('image/jpeg')).toBe(true);
    expect(isAllowedAvatarMimeType('image/png')).toBe(true);
    expect(isAllowedAvatarMimeType('image/webp')).toBe(true);
    expect(isAllowedAvatarMimeType('text/plain')).toBe(false);
    expect(isAllowedAvatarMimeType()).toBe(false);
  });

  it('detects jpeg, png, gif, and webp magic numbers', () => {
    expect(
      detectAvatarImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xdb])),
    ).toBe('jpg');
    expect(
      detectAvatarImageExtension(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('png');
    expect(
      detectAvatarImageExtension(
        Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]),
      ),
    ).toBe('gif');
    expect(
      detectAvatarImageExtension(
        Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50, 0x56, 0x50, 0x38,
        ]),
      ),
    ).toBe('webp');
  });

  it('rejects files without a known image signature', () => {
    expect(
      detectAvatarImageExtension(Buffer.from('not-an-image', 'utf8')),
    ).toBeNull();
  });

  it('creates safe server-side filenames', () => {
    const generated = buildAvatarFilename('../../user-1', 'png');
    expect(generated).toMatch(
      /^[a-zA-Z0-9_-]+-\d{13}-[0-9a-f-]{36}\.png$/,
    );
    expect(generated).not.toContain('/');
    expect(generated).not.toContain('..');
  });

  it('validates generated and legacy avatar filenames', () => {
    expect(
      isValidAvatarFilename(
        'user-1700000000000-123e4567-e89b-12d3-a456-426614174000.webp',
      ),
    ).toBe(true);
    expect(isValidAvatarFilename('user-1700000000000.jpg')).toBe(true);
    expect(isValidAvatarFilename('../etc/passwd')).toBe(false);
    expect(isValidAvatarFilename('avatar.php')).toBe(false);
  });
});
