import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('TenantService', () => {
  let service: TenantService;
  let prisma: any;
  let redisService: any;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };

    redisService = {
      del: jest.fn().mockImplementation(async () => undefined),
      keys: jest.fn().mockImplementation(async () => []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get(TenantService);
  });

  it('findById should expose city and state from primary company', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      name: 'Tenant One',
      companies: [
        {
          id: 'company-1',
          city: 'Surat',
          state: 'Gujarat',
          gstin: '24ABCDE1234F1Z5',
          address: null,
          pincode: null,
          phone: null,
          email: null,
          name: 'Tenant One',
        },
      ],
    });

    const result = await service.findById('tenant-1');

    expect(result.city).toBe('Surat');
    expect(result.state).toBe('Gujarat');
    expect(result.gstin).toBe('24ABCDE1234F1Z5');
  });

  it('update should persist city/state to primary company and return updated profile', async () => {
    prisma.tenant.findUnique
      .mockResolvedValueOnce({
        id: 'tenant-1',
        name: 'Tenant One',
        companies: [
          {
            id: 'company-1',
            city: null,
            state: null,
            gstin: null,
            address: null,
            pincode: null,
            phone: null,
            email: null,
            name: 'Tenant One',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'tenant-1',
        name: 'Tenant One',
        companies: [
          {
            id: 'company-1',
            city: 'Surat',
            state: 'Gujarat',
            gstin: null,
            address: null,
            pincode: null,
            phone: null,
            email: null,
            name: 'Tenant One',
          },
        ],
      });

    prisma.tenant.update.mockResolvedValueOnce({ id: 'tenant-1' });
    prisma.company.findFirst.mockResolvedValueOnce({ id: 'company-1' });
    prisma.company.update.mockResolvedValueOnce({ id: 'company-1' });
    prisma.user.findMany.mockResolvedValueOnce([]);

    const result = await service.update('tenant-1', {
      city: 'Surat',
      state: 'Gujarat',
    });

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-1' },
        data: expect.objectContaining({
          city: 'Surat',
          state: 'Gujarat',
        }),
      }),
    );

    expect(result.city).toBe('Surat');
    expect(result.state).toBe('Gujarat');
  });
});
