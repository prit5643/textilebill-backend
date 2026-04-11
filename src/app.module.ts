import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  s3Config,
  mailConfig,
  whatsappConfig,
} from './config';
import { RequestIdMiddleware, TenantMiddleware } from './common/middleware';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { CompanyModule } from './modules/company/company.module';
import { ProductModule } from './modules/product/product.module';
import { AccountModule } from './modules/account/account.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ReportModule } from './modules/report/report.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ReimbursementsModule } from './modules/reimbursements/reimbursements.module';
import { CostCentersModule } from './modules/cost-centers/cost-centers.module';
import { InsightsModule } from './modules/insights/insights.module';
import { AdminModule } from './modules/admin/admin.module';
import { SystemModule } from './modules/system/system.module';
import { SystemReadyGuard } from './modules/system/system-ready.guard';

const envFileCandidates = [
  join(process.cwd(), '.env'),
  join(process.cwd(), 'backend', '.env'),
];

const envFilePath = envFileCandidates.filter((filePath) =>
  existsSync(filePath),
);

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        s3Config,
        mailConfig,
        whatsappConfig,
      ],
      envFilePath,
    }),

    // Database & Cache
    PrismaModule,
    RedisModule,

    // Feature modules
    AuthModule,
    UsersModule,
    TenantModule,
    CompanyModule,
    ProductModule,
    AccountModule,
    InvoiceModule,
    AccountingModule,
    ReportModule,
    ExpensesModule,
    PayrollModule,
    ReimbursementsModule,
    CostCentersModule,
    InsightsModule,
    AdminModule,
    SystemModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SystemReadyGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');

    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
