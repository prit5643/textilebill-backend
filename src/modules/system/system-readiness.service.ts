import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ReadinessSnapshot {
  ready: boolean;
  checkedAt: string | null;
}

@Injectable()
export class SystemReadinessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemReadinessService.name);
  private readonly cacheMs = 60_000;
  private checkedAt: Date | null = null;
  private ready = false;
  private issues: string[] = [];
  private lastLoggedReady: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.check(true);
  }

  getSnapshot(): ReadinessSnapshot {
    return {
      ready: this.ready,
      checkedAt: this.checkedAt ? this.checkedAt.toISOString() : null,
    };
  }

  async check(force = false): Promise<ReadinessSnapshot> {
    const now = Date.now();
    const shouldReuse =
      !force &&
      this.checkedAt !== null &&
      now - this.checkedAt.getTime() < this.cacheMs;

    if (shouldReuse) {
      return this.getSnapshot();
    }

    const issues = await this.collectIssues();
    this.ready = issues.length === 0;
    this.issues = issues;
    this.checkedAt = new Date();

    this.logIfStateChanged(force);
    return this.getSnapshot();
  }

  private logIfStateChanged(force: boolean): void {
    if (force || this.lastLoggedReady !== this.ready) {
      this.lastLoggedReady = this.ready;
      if (this.ready) {
        this.logger.log('System readiness check passed');
      } else {
        this.logger.error(
          `System readiness check failed:\n- ${this.issues.join('\n- ')}`,
        );
      }
    }
  }

  private async collectIssues(): Promise<string[]> {
    const issues: string[] = [];

    try {
      const requiredTables = [
        'Tenant',
        'Company',
        'User',
        'UserCompany',
        'RefreshToken',
        'OtpChallenge',
        'Party',
        'Account',
        'Product',
        'FinancialYear',
        'VoucherSequence',
        'Invoice',
        'InvoiceItem',
        'LedgerEntry',
        'StockMovement',
      ];

      const tableRows = await this.prisma.$queryRawUnsafe<
        Array<{ table_name: string }>
      >(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
        `,
        requiredTables,
      );

      const existingTables = new Set(tableRows.map((r) => r.table_name));
      const missingTables = requiredTables.filter(
        (t) => !existingTables.has(t),
      );
      if (missingTables.length > 0) {
        issues.push(
          `Missing required tables: ${missingTables.join(', ')}. Run database migrations.`,
        );
      }
    } catch (error: any) {
      issues.push(
        `Unable to validate required tables: ${error?.message ?? 'unknown database error'}.`,
      );
      return issues;
    }

    try {
      const requiredColumns = [
        { table: 'Product', column: 'taxRate' },
        { table: 'Invoice', column: 'version' },
        { table: 'VoucherSequence', column: 'currentValue' },
      ];

      const columnRows = await this.prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string }>
      >(
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'Product' AND column_name = 'taxRate')
              OR
              (table_name = 'Invoice' AND column_name = 'version')
              OR
              (table_name = 'VoucherSequence' AND column_name = 'currentValue')
            )
        `,
      );

      const existingColumns = new Set(
        columnRows.map((r) => `${r.table_name}.${r.column_name}`),
      );

      for (const required of requiredColumns) {
        const key = `${required.table}.${required.column}`;
        if (!existingColumns.has(key)) {
          issues.push(
            `Missing required column ${key}. Run database migrations.`,
          );
        }
      }
    } catch (error: any) {
      issues.push(
        `Unable to validate required columns: ${error?.message ?? 'unknown database error'}.`,
      );
      return issues;
    }

    try {
      const activeUserCount = await this.prisma.user.count({
        where: { status: 'ACTIVE', deletedAt: null },
      });
      if (activeUserCount === 0) {
        this.logger.warn(
          'No active users found. Login will remain unavailable until a user is provisioned.',
        );
      }
    } catch (error: any) {
      issues.push(
        `Unable to validate active users: ${error?.message ?? 'unknown database error'}.`,
      );
    }

    return issues;
  }
}
