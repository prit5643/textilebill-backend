import {
  parseBooleanFlag,
  parsePositiveInt,
  parseTrustProxySetting,
} from './config-value.util';

describe('config-value.util', () => {
  describe('parseBooleanFlag', () => {
    it.each([
      ['true', true],
      ['TRUE', true],
      ['1', true],
      ['yes', true],
      ['on', true],
      ['false', false],
      ['FALSE', false],
      ['0', false],
      ['no', false],
      ['off', false],
    ])('parses %p -> %p', (raw, expected) => {
      expect(parseBooleanFlag(raw)).toBe(expected);
    });

    it('returns undefined for unsupported values', () => {
      expect(parseBooleanFlag('maybe')).toBeUndefined();
      expect(parseBooleanFlag(undefined)).toBeUndefined();
    });
  });

  describe('parsePositiveInt', () => {
    it('uses fallback when value is invalid', () => {
      expect(parsePositiveInt(undefined, 10)).toBe(10);
      expect(parsePositiveInt('abc', 10)).toBe(10);
      expect(parsePositiveInt('-2', 10)).toBe(10);
      expect(parsePositiveInt('0', 10)).toBe(10);
    });

    it('returns normalized positive integer values', () => {
      expect(parsePositiveInt('15', 10)).toBe(15);
      expect(parsePositiveInt(21.8, 10)).toBe(21);
    });
  });

  describe('parseTrustProxySetting', () => {
    it('uses fallback for missing or blank values', () => {
      expect(parseTrustProxySetting(undefined, 1)).toBe(1);
      expect(parseTrustProxySetting('', 1)).toBe(1);
      expect(parseTrustProxySetting('   ', 1)).toBe(1);
    });

    it('parses booleans and numbers', () => {
      expect(parseTrustProxySetting('true', 1)).toBe(true);
      expect(parseTrustProxySetting('false', 1)).toBe(false);
      expect(parseTrustProxySetting('2', 1)).toBe(2);
      expect(parseTrustProxySetting(3, 1)).toBe(3);
    });

    it('parses csv values into an array', () => {
      expect(parseTrustProxySetting('loopback, linklocal', 1)).toEqual([
        'loopback',
        'linklocal',
      ]);
    });

    it('returns a literal string when value is neither boolean/number/csv', () => {
      expect(parseTrustProxySetting('10.0.0.0/8', 1)).toBe('10.0.0.0/8');
    });
  });
});
