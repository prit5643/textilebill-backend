import {
  GSTIN_REGEX,
  MOBILE_REGEX,
  normalizePhone,
  normalizeUppercase,
} from './validation.util';

describe('validation.util', () => {
  describe('GSTIN_REGEX', () => {
    it('accepts valid GSTIN', () => {
      expect(GSTIN_REGEX.test('24AABCU9603R1ZM')).toBe(true);
    });

    it('rejects GSTIN with special characters', () => {
      expect(GSTIN_REGEX.test('24AABCU9603R1Z@')).toBe(false);
    });
  });

  describe('MOBILE_REGEX', () => {
    it('accepts indian 10-digit mobile', () => {
      expect(MOBILE_REGEX.test('9876543210')).toBe(true);
    });

    it('accepts E.164 number', () => {
      expect(MOBILE_REGEX.test('+14155552671')).toBe(true);
    });

    it('rejects formatted number with spaces/symbols', () => {
      expect(MOBILE_REGEX.test('+91-98765-43210')).toBe(false);
    });
  });

  describe('normalizers', () => {
    it('uppercases and trims strings', () => {
      expect(normalizeUppercase('  ab12  ')).toBe('AB12');
    });

    it('trims phone strings', () => {
      expect(normalizePhone('  +919876543210  ')).toBe('+919876543210');
    });
  });
});
