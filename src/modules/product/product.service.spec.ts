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
      product: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      } as any,
      productCategory: {
        create: jest.fn(),
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('createProduct', () => {
    it('should create and return a new product', async () => {
      const mockProduct = { id: 'p1', name: 'Test Product', companyId: 'c1' };
      (prisma.product!.create as jest.Mock).mockResolvedValueOnce(mockProduct);

      const result = await service.createProduct('c1', {
        name: 'Test Product',
        searchCode: 'TST',
        hsnCode: '1234',
        retailPrice: 100,
        buyingPrice: 80,
        uomId: 'uom1',
        categoryId: 'cat1',
        brandId: 'brand1',
      });

      expect(prisma.product!.create).toHaveBeenCalled();
      expect(result).toEqual(mockProduct);
    });

    it('should reject when active company is missing', async () => {
      await expect(
        service.createProduct(undefined as unknown as string, {
          name: 'Test Product',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.product!.create).not.toHaveBeenCalled();
    });
  });

  describe('createCategory', () => {
    it('should throw ConflictException if the category already exists via Prisma error P2002', async () => {
      const prismaError = new Error('Unique constraint failed') as any;
      prismaError.code = 'P2002';

      (prisma.productCategory!.create as jest.Mock).mockRejectedValueOnce(
        prismaError,
      );

      await expect(
        service.createCategory('c1', 'Existing Category'),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create a new category', async () => {
      const mockCategory = { id: 'cat1', name: 'New Category' };
      (prisma.productCategory!.create as jest.Mock).mockResolvedValueOnce(
        mockCategory,
      );

      const result = await service.createCategory('c1', 'New Category');

      expect(result).toEqual(mockCategory);
    });
  });

  describe('findProductById', () => {
    it('should throw NotFoundException if product does not exist', async () => {
      (prisma.product!.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.findProductById('invalid', 'c1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllProducts view projections', () => {
    it('uses selector projection for dropdown payloads', async () => {
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
          retailPrice: true,
          gstRate: true,
          isActive: true,
        }),
      );
      expect(queryArg.select.category).toBeUndefined();
      expect(queryArg.select.brand).toBeUndefined();
    });

    it('uses default list projection and avoids heavy includes', async () => {
      (prisma.product!.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.product!.count as jest.Mock).mockResolvedValueOnce(0);

      await service.findAllProducts('c1', {
        page: 1,
        limit: 25,
      });

      const queryArg = (prisma.product!.findMany as jest.Mock).mock.calls[0][0];
      expect(queryArg.select).toEqual(
        expect.objectContaining({
          id: true,
          companyId: true,
          name: true,
          hsnCode: true,
          retailPrice: true,
          gstRate: true,
          isActive: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        }),
      );
      expect(queryArg.include).toBeUndefined();
    });
  });
});
