import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import {
  LoggingInterceptor,
  TransformInterceptor,
  AuditLogInterceptor,
} from './common/interceptors';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './modules/redis/redis.service';
import {
  createAuthRateLimiters,
  createWriteRateLimiters,
} from './modules/auth/auth-rate-limit.util';
import type { TrustProxySetting } from './common/utils/config-value.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api');
  const nodeEnv = configService.get<string>('app.nodeEnv', 'development');
  const enableSwagger = configService.get<boolean | undefined>(
    'app.enableSwagger',
  );
  const shouldEnableSwagger = enableSwagger ?? nodeEnv !== 'production';
  const slowRequestMs = configService.get<number>('app.slowRequestMs', 1500);
  const trustProxy = configService.get<TrustProxySetting>('app.trustProxy', 1);
  const redisService = app.get(RedisService);

  // Global prefix
  app.setGlobalPrefix(apiPrefix, {
    exclude: [{ path: 'uploads/(.*)', method: RequestMethod.ALL }],
  });
  app.set('trust proxy', trustProxy);

  const normalizedApiPrefix = `/${apiPrefix.trim().replace(/^\/+|\/+$/g, '')}`;
  const apiPrefixAlias =
    normalizedApiPrefix === '/api'
      ? '/api/v1'
      : normalizedApiPrefix === '/api/v1'
        ? '/api'
        : undefined;

  if (apiPrefixAlias) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.url === apiPrefixAlias || req.url.startsWith(`${apiPrefixAlias}/`)) {
        req.url = `${normalizedApiPrefix}${req.url.slice(apiPrefixAlias.length)}`;
      }
      next();
    });
  }

  // Prepare uploads directory
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  // Security
  const isProduction = nodeEnv === 'production';
  const cspDirectives: Record<string, string[]> = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'https:', 'data:'],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    objectSrc: ["'none'"],
    scriptSrc: isProduction
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
  };

  if (isProduction) {
    cspDirectives.upgradeInsecureRequests = [];
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: cspDirectives },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      hsts: isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Company-Id',
      'X-Request-ID',
      'X-Device-Id',
      'Idempotency-Key',
    ],
  });

  for (const limiter of createAuthRateLimiters(
    configService,
    apiPrefix,
    redisService,
  )) {
    app.use(limiter.path, limiter.middleware);
  }

  for (const limiter of createWriteRateLimiters(
    configService,
    apiPrefix,
    redisService,
  )) {
    app.use(limiter.path, limiter.middleware);
  }

  // Global pipes
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

  // Global filters & interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(slowRequestMs),
    new IdempotencyInterceptor(redisService),
    new AuditLogInterceptor(app.get(PrismaService)),
    new TransformInterceptor(),
  );

  if (shouldEnableSwagger) {
    // Swagger API docs
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TextileBill API')
      .setDescription('Textile SaaS — Billing & Stock Management Platform API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT access token',
          in: 'header',
        },
        'access-token',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-Company-Id',
          in: 'header',
          description: 'Active company ID for multi-company support',
        },
        'company-id',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}`);
  if (shouldEnableSwagger) {
    logger.log(`Swagger docs at http://localhost:${port}/${apiPrefix}/docs`);
  } else {
    logger.log('Swagger docs disabled for this environment');
  }
}

bootstrap();
