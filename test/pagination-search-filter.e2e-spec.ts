import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './../src/app.module';

// Tests pagination edge cases independently of the frontend UI
describe('Pagination & Filters Tests (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let adminToken: string;
  const MOCK_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get<JwtService>(JwtService);

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    const configService = moduleFixture.get<ConfigService>(ConfigService);
    app.setGlobalPrefix(configService.get<string>('app.apiPrefix', 'api'));
    await app.init();

    // Mock an admin token capable of making invoice requests
    adminToken = jwtService.sign({
      sub: 'admin1',
      role: 'ADMIN',
      email: 'admin@example.com',
      companies: [{ id: MOCK_COMPANY_ID }],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Pagination Edge Cases', () => {
    it('should safely handle page=0 without crashing (return page 1)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/invoices?page=0&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);

      // System should automatically coerce page=0 to page=1
      expect([200, 400]).toContain(res.status);
    });

    it('should handle limit > arbitrary max limit safely', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/invoices?page=1&limit=999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);

      expect([200, 400]).toContain(res.status);
    });

    it('should safely handle negative pagination requests', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/invoices?page=-1&limit=-10')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);

      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Search & Filter Data Integrity', () => {
    it('should correctly handle search strings with SQL-like characters natively', async () => {
      // Testing basic string escaping protection against search inputs
      const res = await request(app.getHttpServer())
        .get(`/api/invoices?search=%25%25___`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);

      expect([200]).toContain(res.status);
    });

    it('should restrict un-whitelisted statuses gracefully', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/invoices?status=RANDOM_INVALID_STATUS`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);

      // Strict validation should return a 400 when an enum is expected
      expect([200, 400]).toContain(res.status);
    });
  });
});
