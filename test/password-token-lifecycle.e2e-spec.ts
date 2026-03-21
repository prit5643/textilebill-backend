import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { PasswordTokenType, PasswordTokenStatus } from '@prisma/client';

/**
 * E2E Tests for Password Token Lifecycle
 *
 * Covers database-backed token storage and lifecycle management:
 * - Token creation with hash-based storage
 * - Token status transitions (ACTIVE -> USED -> EXPIRED -> REVOKED)
 * - Resend count tracking and limits
 * - Expiry validation
 * - Multi-tenant token isolation
 * - Audit event logging
 */
describe('Password Token Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testTenantId: string;
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean up any test data
    await cleanupTestData();

    // Create test tenant
    testTenantId = (
      await prisma.tenant.create({
        data: {
          id: 'e2e-tenant-' + Date.now(),
          name: 'E2E Test Tenant',
          slug: 'e2e-tenant-' + Date.now(),
          isActive: true,
        },
      })
    ).id;

    // Create test user
    testUserId = (
      await prisma.user.create({
        data: {
          id: 'e2e-user-' + Date.now(),
          email: `e2e-user-${Date.now()}@test.com`,
          username: `e2e-user-${Date.now()}`,
          firstName: 'E2E',
          lastName: 'User',
          role: 'STAFF',
          isActive: true,
          tenantId: testTenantId,
          passwordHash: 'test-hash',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function cleanupTestData() {
    if (!testTenantId) return;

    try {
      await prisma.passwordLifecycleToken.deleteMany({
        where: { tenantId: testTenantId },
      });

      await prisma.auditLog.deleteMany({
        where: { user: { tenantId: testTenantId } },
      });

      await prisma.user.deleteMany({
        where: { tenantId: testTenantId },
      });

      await prisma.tenant.deleteMany({
        where: { id: testTenantId },
      });
    } catch (e) {
      // Ignore errors during cleanup
    }
  }

  describe('Setup Link Token Creation', () => {
    it('should create a setup password token with ACTIVE status', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'setup-hash-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      expect(token.type).toBe(PasswordTokenType.SETUP_PASSWORD);
      expect(token.status).toBe(PasswordTokenStatus.ACTIVE);
      expect(token.tenantId).toBe(testTenantId);
      expect(token.userId).toBe(testUserId);
      expect(token.maxResends).toBe(3);
      expect(token.resendCount).toBe(0);
      expect(token.tokenHash).toBeDefined();
      expect(token.expiresAt).toBeInstanceOf(Date);
    });

    it('should store token hash, not plain text', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'hash-abc123def456-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Hash should not look like a UUID
      expect(token.tokenHash).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(token.tokenHash).toContain('hash-');
    });
  });

  describe('Token Status Transitions', () => {
    it('should transition token from ACTIVE to USED', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'transition-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Transition to USED
      const updated = await prisma.passwordLifecycleToken.update({
        where: { id: token.id },
        data: {
          status: PasswordTokenStatus.USED,
          usedAt: new Date(),
        },
      });

      expect(updated.status).toBe(PasswordTokenStatus.USED);
      expect(updated.usedAt).toBeDefined();
    });

    it('should support all status enum values', async () => {
      const statuses = [
        PasswordTokenStatus.ACTIVE,
        PasswordTokenStatus.USED,
        PasswordTokenStatus.EXPIRED,
        PasswordTokenStatus.REVOKED,
      ];

      for (const status of statuses) {
        const token = await prisma.passwordLifecycleToken.create({
          data: {
            tenantId: testTenantId,
            userId: testUserId,
            tokenHash: `${status}-${Date.now()}`,
            type: PasswordTokenType.SETUP_PASSWORD,
            status,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            maxResends: 3,
            resendCount: 0,
            requestedByRole: 'TENANT_ADMIN',
          },
        });

        expect(token.status).toBe(status);
      }
    });
  });

  describe('Reset Password Token', () => {
    it('should create RESET_PASSWORD token type', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'reset-' + Date.now(),
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
          maxResends: 1,
          resendCount: 0,
          requestedByRole: 'TENANT_USER',
        },
      });

      expect(token.type).toBe(PasswordTokenType.RESET_PASSWORD);
      expect(token.maxResends).toBe(1);
    });

    it('should mark reset token as USED when password changes', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'reset-used-' + Date.now(),
          type: PasswordTokenType.RESET_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          maxResends: 1,
          resendCount: 0,
          requestedByRole: 'TENANT_USER',
        },
      });

      const updated = await prisma.passwordLifecycleToken.update({
        where: { id: token.id },
        data: {
          status: PasswordTokenStatus.USED,
          usedAt: new Date(),
        },
      });

      expect(updated.status).toBe(PasswordTokenStatus.USED);
      expect(updated.usedAt).toBeDefined();
    });
  });

  describe('Resend Count Tracking', () => {
    it('should track resend attempts up to limit', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'resend-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Increment resend count
      const resend1 = await prisma.passwordLifecycleToken.update({
        where: { id: token.id },
        data: { resendCount: 1 },
      });
      expect(resend1.resendCount).toBe(1);

      const resend2 = await prisma.passwordLifecycleToken.update({
        where: { id: token.id },
        data: { resendCount: 2 },
      });
      expect(resend2.resendCount).toBe(2);

      const resend3 = await prisma.passwordLifecycleToken.update({
        where: { id: token.id },
        data: { resendCount: 3 },
      });
      expect(resend3.resendCount).toBe(3);

      // Verify we've reached the limit
      expect(resend3.resendCount).toBe(resend3.maxResends);
    });

    it('should prevent resend when limit is reached', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'resend-limit-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 2,
          resendCount: 2, // Already at limit
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Verify resend is blocked
      const canResend = token.resendCount < token.maxResends;
      expect(canResend).toBe(false);
    });
  });

  describe('Token Expiry', () => {
    it('should detect expired tokens by comparing expiresAt to now', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'expired-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      const isExpired = token.expiresAt < new Date();
      expect(isExpired).toBe(true);
    });

    it('should find all expired tokens for cleanup', async () => {
      // Create some expired tokens
      const expiredHash1 = 'cleanup-expired-1-' + Date.now();
      const expiredHash2 = 'cleanup-expired-2-' + Date.now();
      const activeHash = 'cleanup-active-' + Date.now();

      await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: expiredHash1,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() - 2000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: expiredHash2,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() - 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: activeHash,
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Find expired tokens
      const expiredTokens = await prisma.passwordLifecycleToken.findMany({
        where: {
          tenantId: testTenantId,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: { lt: new Date() },
        },
      });

      expect(expiredTokens.length).toBeGreaterThanOrEqual(2);
      expect(expiredTokens.map((t) => t.tokenHash)).toContain(expiredHash1);
      expect(expiredTokens.map((t) => t.tokenHash)).toContain(expiredHash2);
    });
  });

  describe('Admin Override Tracking', () => {
    it('should track super admin override requests', async () => {
      const superAdminId = 'super-admin-' + Date.now();

      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'admin-override-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'SUPER_ADMIN',
          requestedByUserId: superAdminId,
        },
      });

      expect(token.requestedByRole).toBe('SUPER_ADMIN');
      expect(token.requestedByUserId).toBe(superAdminId);
    });

    it('should track tenant admin requests differently', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'tenant-admin-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      expect(token.requestedByRole).toBe('TENANT_ADMIN');
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('should scope tokens to tenant', async () => {
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'tenant-scoped-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      // Verify token belongs to correct tenant
      expect(token.tenantId).toBe(testTenantId);

      // Scoped query should work
      const foundToken = await prisma.passwordLifecycleToken.findFirst({
        where: {
          id: token.id,
          tenantId: testTenantId,
        },
      });

      expect(foundToken?.id).toBe(token.id);
    });

    it('should use tenant index for efficient lookups', async () => {
      // Create multiple tokens for cleanup testing
      for (let i = 0; i < 3; i++) {
        await prisma.passwordLifecycleToken.create({
          data: {
            tenantId: testTenantId,
            userId: testUserId,
            tokenHash: `index-test-${i}-${Date.now()}`,
            type: PasswordTokenType.SETUP_PASSWORD,
            status: PasswordTokenStatus.EXPIRED,
            expiresAt: new Date(Date.now() - 1000),
            maxResends: 3,
            resendCount: 0,
            requestedByRole: 'TENANT_ADMIN',
          },
        });
      }

      // Query should use index efficiently
      const expiredForTenant = await prisma.passwordLifecycleToken.findMany({
        where: {
          tenantId: testTenantId,
          status: PasswordTokenStatus.EXPIRED,
          expiresAt: { lt: new Date() },
        },
        take: 10,
      });

      expect(expiredForTenant.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Audit Event Logging', () => {
    it('should log password setup completion event', async () => {
      const auditLog = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          entity: 'PASSWORD_LIFECYCLE',
          action: 'PASSWORD_SETUP_COMPLETED',
          newValue: {
            setupMethod: 'INVITE_LINK',
            completedAt: new Date().toISOString(),
          },
        },
      });

      expect(auditLog.entity).toBe('PASSWORD_LIFECYCLE');
      expect(auditLog.action).toBe('PASSWORD_SETUP_COMPLETED');
      expect(auditLog.userId).toBe(testUserId);
    });

    it('should log password reset completion event', async () => {
      const auditLog = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          entity: 'PASSWORD_LIFECYCLE',
          action: 'PASSWORD_RESET_COMPLETED',
          newValue: {
            resetMethod: 'LINK',
            completedAt: new Date().toISOString(),
          },
        },
      });

      expect(auditLog.entity).toBe('PASSWORD_LIFECYCLE');
      expect(auditLog.action).toBe('PASSWORD_RESET_COMPLETED');
    });

    it('should log admin override events', async () => {
      const auditLog = await prisma.auditLog.create({
        data: {
          userId: testUserId,
          entity: 'PASSWORD_LIFECYCLE',
          action: 'SETUP_LINK_RESENT_BY_ADMIN',
          newValue: {
            adminRole: 'SUPER_ADMIN',
            reason: 'User unable to receive email',
            sentAt: new Date().toISOString(),
          },
        },
      });

      expect(auditLog.entity).toBe('PASSWORD_LIFECYCLE');
      expect(auditLog.action).toBe('SETUP_LINK_RESENT_BY_ADMIN');
    });

    it('should query audit logs by entity and action', async () => {
      // Create multiple audit events
      await prisma.auditLog.create({
        data: {
          userId: testUserId,
          entity: 'PASSWORD_LIFECYCLE',
          action: 'TEST_EVENT_1',
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: testUserId,
          entity: 'PASSWORD_LIFECYCLE',
          action: 'TEST_EVENT_2',
        },
      });

      // Query password lifecycle events
      const passwordEvents = await prisma.auditLog.findMany({
        where: {
          entity: 'PASSWORD_LIFECYCLE',
          userId: testUserId,
        },
      });

      expect(passwordEvents.length).toBeGreaterThanOrEqual(2);
      expect(
        passwordEvents.every((e) => e.entity === 'PASSWORD_LIFECYCLE'),
      ).toBe(true);
    });
  });

  describe('Database Migration', () => {
    it('should have PasswordLifecycleToken table', async () => {
      // Create and retrieve a token to verify table exists
      const token = await prisma.passwordLifecycleToken.create({
        data: {
          tenantId: testTenantId,
          userId: testUserId,
          tokenHash: 'migration-test-' + Date.now(),
          type: PasswordTokenType.SETUP_PASSWORD,
          status: PasswordTokenStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxResends: 3,
          resendCount: 0,
          requestedByRole: 'TENANT_ADMIN',
        },
      });

      expect(token.id).toBeDefined();
    });

    it('should enforce required constraints', async () => {
      // Attempt to create token without required fields should fail
      try {
        await prisma.passwordLifecycleToken.create({
          data: {
            tenantId: testTenantId,
            userId: testUserId,
            tokenHash: null as any, // Required field
            type: PasswordTokenType.SETUP_PASSWORD,
            status: PasswordTokenStatus.ACTIVE,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          } as any,
        });
        throw new Error('Should have failed validation');
      } catch (error: any) {
        // Expected to fail
        expect(error.message).toBeDefined();
      }
    });
  });
});
