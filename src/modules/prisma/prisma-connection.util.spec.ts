import {
  getRetryDelayMs,
  hasConnectionLimit,
  isPgBouncerConnection,
  normalizeDatabaseUrl,
  redactDatabaseUrl,
} from './prisma-connection.util';

describe('prisma-connection.util', () => {
  describe('redactDatabaseUrl', () => {
    it('masks credentials in connection strings', () => {
      const output = redactDatabaseUrl(
        'postgresql://user:password@db.example.com:5432/textilebill',
      );

      expect(output).toContain('postgresql://user:***@db.example.com:5432');
      expect(output).not.toContain('password');
    });

    it('returns placeholder for invalid URLs', () => {
      expect(redactDatabaseUrl('not-a-url')).toBe('<invalid-database-url>');
    });
  });

  describe('isPgBouncerConnection', () => {
    it('detects explicit pgbouncer flag', () => {
      expect(
        isPgBouncerConnection(
          'postgresql://u:p@pool.example.com:5432/db?pgbouncer=true',
        ),
      ).toBe(true);
    });

    it('detects default pgbouncer port', () => {
      expect(
        isPgBouncerConnection('postgresql://u:p@pool.example.com:6432/db'),
      ).toBe(true);
    });

    it('returns false for standard postgres URL', () => {
      expect(
        isPgBouncerConnection('postgresql://u:p@db.example.com:5432/db'),
      ).toBe(false);
    });

    it('detects Supabase pooler hosts', () => {
      expect(
        isPgBouncerConnection(
          'postgresql://u:p@project.pooler.supabase.com:6543/postgres',
        ),
      ).toBe(true);
    });
  });

  describe('normalizeDatabaseUrl', () => {
    it('injects pooler-safe params for Supabase pooler connections', () => {
      const normalized = normalizeDatabaseUrl(
        'postgresql://u:p@project.pooler.supabase.com:6543/postgres',
      );

      expect(normalized).toContain('pgbouncer=true');
      expect(normalized).toContain('connection_limit=5');
    });

    it('keeps non-pooler urls unchanged', () => {
      const url = 'postgresql://u:p@db.example.com:5432/postgres';
      expect(normalizeDatabaseUrl(url)).toBe(url);
    });
  });

  describe('hasConnectionLimit', () => {
    it('returns true when connection_limit is configured', () => {
      expect(
        hasConnectionLimit(
          'postgresql://u:p@db.example.com:5432/db?connection_limit=5',
        ),
      ).toBe(true);
    });

    it('returns false when connection_limit is missing or invalid', () => {
      expect(
        hasConnectionLimit('postgresql://u:p@db.example.com:5432/db'),
      ).toBe(false);
      expect(
        hasConnectionLimit(
          'postgresql://u:p@db.example.com:5432/db?connection_limit=0',
        ),
      ).toBe(false);
    });
  });

  describe('getRetryDelayMs', () => {
    it('uses exponential backoff and respects max delay', () => {
      expect(getRetryDelayMs(1, 250, 5000)).toBe(250);
      expect(getRetryDelayMs(2, 250, 5000)).toBe(500);
      expect(getRetryDelayMs(3, 250, 5000)).toBe(1000);
      expect(getRetryDelayMs(8, 250, 5000)).toBe(5000);
    });
  });
});
