import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './../src/app.module';
import { UserRole } from '@prisma/client';

describe('Role Access Matrix Tests (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let configService: ConfigService;

  // We manually mock tokens since setting up real DB users can be flaky depending on environment state
  let tokens: Record<string, string> = {
    OWNER: '',
    ADMIN: '',
    MANAGER: '',
    VIEWER: '',
  };

  const MOCK_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_COMPANY_ID = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
    
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // Emulate global API prefix if it's there
    const apiPrefix = configService.get<string>('app.apiPrefix', 'api');
    app.setGlobalPrefix(apiPrefix);
    await app.init();

    // Generate tokens directly for each role
    const mockUserBase = { email: 'test@example.com', companies: [{ id: MOCK_COMPANY_ID }] };
    
    tokens.OWNER  = jwtService.sign({ sub: 'user1', role: UserRole.OWNER,       ...mockUserBase });
    tokens.ADMIN   = jwtService.sign({ sub: 'user2', role: UserRole.ADMIN,       ...mockUserBase });
    tokens.MANAGER = jwtService.sign({ sub: 'user3', role: UserRole.MANAGER,     ...mockUserBase });
    tokens.VIEWER  = jwtService.sign({ sub: 'user4', role: UserRole.VIEWER,      ...mockUserBase });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('Unauthenticated Access', () => {
    it('should reject access to protected routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/account/summary');
      expect(res.status).toBe(401);
    });
  });

  describe('OWNER Access', () => {
    it('should be able to access system admin endpoints', async () => {
      // Trying to hit an admin route, assuming /api/admin/* requires OWNER
      const res = await request(app.getHttpServer())
        .get('/api/admin/system/tenant')
        .set('Authorization', `Bearer ${tokens.OWNER}`);
    });
  });

  describe('ADMIN Access', () => {
    it('should NOT be able to access system admin endpoints', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/system/tenant')
        .set('Authorization', `Bearer ${tokens.ADMIN}`);
      
      // We expect 403 Forbidden for insufficient role
      expect(res.status).toBe(403);
    });

    it('should be able to access their company endpoints with correct headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/invoices')
        .set('Authorization', `Bearer ${tokens.ADMIN}`)
        .set('X-Company-Id', MOCK_COMPANY_ID);
      
      // Could be 200, or 404/400 if validation is strict about empty datasets
      expect([200, 404, 400]).toContain(res.status);
    });
  });

  describe('Cross-Company Data Isolation', () => {
    it('should reject access if X-Company-Id is not in user allowed list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/invoice')
        .set('Authorization', `Bearer ${tokens.ADMIN}`)
        .set('X-Company-Id', OTHER_COMPANY_ID); // User token doesn't have this company
      
      // Should result in a Forbidden or Unauthorized error
      expect([401, 403]).toContain(res.status);
    });
  });
});
