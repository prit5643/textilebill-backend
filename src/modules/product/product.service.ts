import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';

type ProductListView = 'default' | 'selector';

const PRODUCT_LIST_DEFAULT_SELECT = {
  id: true,
  companyId: true,
  name: true,
  hsnCode: true,
  retailPrice: true,
  gstRate: true,
  isActive: true,
  category: {
    select: {
      id: true,
      name: true,
    },
  },
  brand: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.ProductSelect;

const PRODUCT_LIST_SELECTOR_SELECT = {
  id: true,
  name: true,
  hsnCode: true,
  retailPrice: true,
  gstRate: true,
  isActive: true,
} satisfies Prisma.ProductSelect;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireCompanyId(companyId?: string): string {
    if (!companyId) {
      throw new BadRequestException(
        'Active company is required. Please select a company and try again.',
      );
    }

    return companyId;
  }

  private getListSelect(view: ProductListView): Prisma.ProductSelect {
    return view === 'selector'
      ? PRODUCT_LIST_SELECTOR_SELECT
      : PRODUCT_LIST_DEFAULT_SELECT;
  }

  private normalizeProductName(name?: string | null): string {
    return (name ?? '').trim();
  }

  private normalizeHsnCode(hsnCode?: string | null): string | null {
    const normalized = hsnCode?.trim();
    return normalized ? normalized : null;
  }

  private async ensureNoDuplicateProduct(
    companyId: string,
    name: string,
    hsnCode: string | null,
    excludeProductId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.product.findFirst({
      where: {
        companyId,
        isActive: true,
        id: excludeProductId ? { not: excludeProductId } : undefined,
        name: { equals: name, mode: 'insensitive' },
        hsnCode,
      },
      select: {
        id: true,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'A product with the same name and HSN code already exists.',
      );
    }
  }

  // ═══════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════

  async createProduct(companyId: string, dto: CreateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.normalizeProductName(dto.name);
    const normalizedHsnCode = this.normalizeHsnCode(dto.hsnCode);

    await this.ensureNoDuplicateProduct(
      scopedCompanyId,
      normalizedName,
      normalizedHsnCode,
    );

    const product = await this.prisma.product.create({
      data: {
        companyId: scopedCompanyId,
        name: normalizedName,
        searchCode: dto.searchCode,
        hsnCode: normalizedHsnCode,
        sacCode: dto.sacCode,
        description: dto.description,
        retailPrice: dto.retailPrice,
        buyingPrice: dto.buyingPrice,
        mrp: dto.mrp,
        wholesalerPrice: dto.wholesalerPrice,
        distributorPrice: dto.distributorPrice,
        gstRate: dto.gstRate ?? 0,
        uomId: dto.uomId,
        type: dto.type ?? 'GOODS',
        gstConsiderAs: dto.gstConsiderAs ?? 'TAXABLE',
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        defaultQty: dto.defaultQty ?? 1,
        defaultDiscount: dto.defaultDiscount ?? 0,
        minimumQty: dto.minimumQty ?? 0,
        customField1: dto.customField1,
        customField2: dto.customField2,
        customField3: dto.customField3,
        customField4: dto.customField4,
        customField5: dto.customField5,
        customField6: dto.customField6,
      },
      include: { uom: true, category: true, brand: true },
    });

    this.logger.log(`Product created: ${product.name} (${product.id})`);
    return product;
  }

  async findAllProducts(
    companyId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: string;
      brandId?: string;
      type?: string;
      isActive?: boolean;
      view?: ProductListView;
    },
  ) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const { skip, take, page, limit } = parsePagination({
      page: options?.page,
      limit: options?.limit,
    });

    const where: any = { companyId: scopedCompanyId };
    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { searchCode: { contains: options.search, mode: 'insensitive' } },
        { hsnCode: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (options?.categoryId) where.categoryId = options.categoryId;
    if (options?.brandId) where.brandId = options.brandId;
    if (options?.type) where.type = options.type;
    if (options?.isActive !== undefined) where.isActive = options.isActive;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: this.getListSelect(options?.view ?? 'default'),
      }),
      this.prisma.product.count({ where }),
    ]);

    return createPaginatedResult(data, total, page, limit);
  }

  async findProductById(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: scopedCompanyId },
      include: { uom: true, category: true, brand: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async updateProduct(id: string, companyId: string, dto: UpdateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const existing = await this.findProductById(id, scopedCompanyId);

    const nextName = this.normalizeProductName(dto.name ?? existing.name);
    const nextHsnCode = this.normalizeHsnCode(dto.hsnCode ?? existing.hsnCode);

    await this.ensureNoDuplicateProduct(
      scopedCompanyId,
      nextName,
      nextHsnCode,
      id,
    );

    const updateData: Prisma.ProductUpdateInput = {
      ...dto,
      name: dto.name ? nextName : undefined,
      hsnCode: dto.hsnCode !== undefined ? nextHsnCode : undefined,
    };

    return this.prisma.product.update({
      where: { id },
      data: updateData,
      include: { uom: true, category: true, brand: true },
    });
  }

  async removeProduct(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    await this.findProductById(id, scopedCompanyId);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async removeProductPermanently(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    await this.findProductById(id, scopedCompanyId);

    try {
      return await this.prisma.product.delete({
        where: { id },
      });
    } catch (err: any) {
      if (err?.code === 'P2003') {
        throw new ConflictException(
          'This product is linked to existing transactions and cannot be permanently deleted.',
        );
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════
  // CATEGORIES
  // ═══════════════════════════════════════════════════

  async createCategory(companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    try {
      return await this.prisma.productCategory.create({
        data: { companyId: scopedCompanyId, name },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw err;
    }
  }

  async findAllCategories(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    return this.prisma.productCategory.findMany({
      where: { companyId: scopedCompanyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async updateCategory(id: string, companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const cat = await this.prisma.productCategory.findFirst({
      where: { id, companyId: scopedCompanyId },
    });
    if (!cat) throw new NotFoundException('Category not found');

    return this.prisma.productCategory.update({
      where: { id },
      data: { name },
    });
  }

  async removeCategory(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const cat = await this.prisma.productCategory.findFirst({
      where: { id, companyId: scopedCompanyId },
    });
    if (!cat) throw new NotFoundException('Category not found');

    return this.prisma.productCategory.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════
  // BRANDS
  // ═══════════════════════════════════════════════════

  async createBrand(companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    try {
      return await this.prisma.brand.create({
        data: { companyId: scopedCompanyId, name },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Brand already exists');
      }
      throw err;
    }
  }

  async findAllBrands(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    return this.prisma.brand.findMany({
      where: { companyId: scopedCompanyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async updateBrand(id: string, companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const brand = await this.prisma.brand.findFirst({
      where: { id, companyId: scopedCompanyId },
    });
    if (!brand) throw new NotFoundException('Brand not found');

    return this.prisma.brand.update({
      where: { id },
      data: { name },
    });
  }

  async removeBrand(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const brand = await this.prisma.brand.findFirst({
      where: { id, companyId: scopedCompanyId },
    });
    if (!brand) throw new NotFoundException('Brand not found');

    return this.prisma.brand.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════
  // UOMs (global — not per-company)
  // ═══════════════════════════════════════════════════

  async findAllUoms() {
    return this.prisma.unitOfMeasurement.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createUom(name: string, fullName?: string) {
    try {
      return await this.prisma.unitOfMeasurement.create({
        data: { name: name.toUpperCase(), fullName },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('UOM already exists');
      }
      throw err;
    }
  }
}
