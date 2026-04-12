import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          tenantId: 't1',
          deletedAt: null,
        }),
      } as any,
      product: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      } as any,
      productOption: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  it('creates products with schema-v2 fields', async () => {
    (prisma.product!.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.productOption!.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.productOption!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'uom-mtr',
      companyId: 'c1',
      name: 'MTR',
      fullName: 'Meter',
      isDefault: true,
    });
    (prisma.product!.create as jest.Mock).mockResolvedValueOnce({
      id: 'p1',
      name: 'Test Product',
      companyId: 'c1',
    });

    const result = await service.createProduct('c1', {
      name: 'Test Product',
      searchCode: 'TST',
      hsnCode: '1234',
      retailPrice: 100,
      gstRate: 5,
    });

    expect(prisma.product!.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          companyId: 'c1',
          name: 'Test Product',
          sku: 'TST',
          unit: 'MTR',
          price: 100,
          taxRate: 5,
        }),
      }),
    );
    expect(result).toEqual({ id: 'p1', name: 'Test Product', companyId: 'c1' });
  });

  it('rejects when company context is missing', async () => {
    await expect(
      service.createProduct(undefined as unknown as string, { name: 'Test' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws conflict when duplicate active product exists', async () => {
    (prisma.product!.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'p1',
    });

    await expect(
      service.createProduct('c1', { name: 'Dup Product' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws not found when product is missing by id', async () => {
    (prisma.product!.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.findProductById('missing', 'c1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('uses selector projection for lightweight dropdown payloads', async () => {
    (prisma.product!.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.product!.count as jest.Mock).mockResolvedValueOnce(0);

    await service.findAllProducts('c1', {
      page: 1,
      limit: 25,
      view: 'selector',
    });

    const queryArg = (prisma.product!.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArg.select).toEqual(
      expect.objectContaining({
        id: true,
        name: true,
        hsnCode: true,
        price: true,
        taxRate: true,
        unit: true,
        deletedAt: true,
      }),
    );
  });
});
