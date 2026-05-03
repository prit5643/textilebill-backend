import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import {
  getRetryDelayMs,
  hasConnectionLimit,
  isPgBouncerConnection,
  normalizeDatabaseUrl,
  redactDatabaseUrl,
} from './prisma-connection.util';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const configuredDatabaseUrl =
      configService.get<string>('database.url') ?? process.env.DATABASE_URL;
    if (!configuredDatabaseUrl) {
      throw new Error('DATABASE_URL is required.');
    }

    const databaseUrl = normalizeDatabaseUrl(configuredDatabaseUrl);

    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ],
    });

    this.databaseUrl = databaseUrl;

    if (configuredDatabaseUrl !== databaseUrl) {
      this.logger.warn(
        'Normalized DATABASE_URL for Supabase pooler (pgbouncer=true, connection_limit=5).',
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logConnectionProfile(): void {
    const nodeEnv = this.configService.get<string>(
      'app.nodeEnv',
      'development',
    );
    const redactedUrl = redactDatabaseUrl(this.databaseUrl);
    const usesPgBouncer = isPgBouncerConnection(this.databaseUrl);
    const usesConnectionLimit = hasConnectionLimit(this.databaseUrl);

    this.logger.log(`Database target: ${redactedUrl}`);

    if (!usesPgBouncer && nodeEnv === 'production') {
      this.logger.warn(
        'DATABASE_URL does not appear to use PgBouncer. For multi-server production deployments, route app traffic through a pooler.',
      );
    }

    if (!usesConnectionLimit && nodeEnv === 'production') {
      this.logger.warn(
        'DATABASE_URL has no connection_limit parameter. Configure connection_limit per app instance to prevent connection storms.',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    this.logConnectionProfile();

    const maxRetries = this.configService.get<number>(
      'database.connectMaxRetries',
      8,
    );
    const baseDelayMs = this.configService.get<number>(
      'database.connectRetryBaseMs',
      250,
    );
    const maxDelayMs = this.configService.get<number>(
      'database.connectRetryMaxMs',
      5000,
    );

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await this.$connect();
        this.logger.log(
          `Database connected (attempt ${attempt}/${maxRetries})`,
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) {
          break;
        }

        const retryDelayMs = getRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxRetries} failed. Retrying in ${retryDelayMs}ms.`,
        );
        await this.delay(retryDelayMs);
      }
    }

    this.logger.error(
      `Database connection failed after ${maxRetries} attempts.`,
    );
    if (lastError instanceof Error) {
      this.logger.warn(
        `Continuing startup without an active database connection: ${lastError.message}`,
      );
    } else {
      this.logger.warn(
        'Continuing startup without an active database connection.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
