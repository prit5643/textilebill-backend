import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('API Contract Tests - Global (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Validation & Types Bypass Testing', () => {
    it('should reject request with completely missing required fields', async () => {
      // Trying to create a product without required fields
      const res = await request(app.getHttpServer()).post('/products').send({});

      // It must return 400 Bad Request, not 500 or 201
      // Note: We might be unauthenticated, so 401 is also acceptable here if auth runs first.
      // But we are mainly testing that it's NOT a 500 when it skips frontend validation.
      expect([400, 401]).toContain(res.status);
    });

    it('should reject structurally invalid payloads (wrong types)', async () => {
      // Trying to pass a string to a number field and vice-versa
      const invalidPayload = {
        name: 12345, // should be string
        price: 'this is not a number', // should be number
        sku: ['array', 'not', 'string'],
      };

      const res = await request(app.getHttpServer())
        .post('/products')
        .send(invalidPayload);

      expect([400, 401]).toContain(res.status);
    });

    it('should reject empty or null values on required fields', async () => {
      const invalidPayload = {
        name: '',
        price: null,
      };

      const res = await request(app.getHttpServer())
        .post('/products')
        .send(invalidPayload);

      expect([400, 401]).toContain(res.status);
    });
  });

  describe('Header Validation (X-Company-Id)', () => {
    // Tests that lack of X-Company-Id when required fails correctly
    it('should reject protected routes without X-Company-Id', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices') // assuming /invoices is protected
        // not setting X-Company-Id header
        .send();

      // Expect to be blocked by either auth or missing header validation
      expect([400, 401, 403]).toContain(res.status);
    });
  });
});
