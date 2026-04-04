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
  tenantId: true,
  companyId: true,
  name: true,
  sku: true,
  unit: true,
  hsnCode: true,
  price: true,
  taxRate: true,
  deletedAt: true,
} satisfies Prisma.ProductSelect;

const PRODUCT_LIST_SELECTOR_SELECT = {
  id: true,
  name: true,
  hsnCode: true,
  price: true,
  taxRate: true,
  unit: true,
  deletedAt: true,
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

  private normalizeName(name?: string | null): string {
    return (name ?? '').trim();
  }

  private normalizeHsnCode(hsnCode?: string | null): string | null {
    const normalized = hsnCode?.trim();
    return normalized ? normalized : null;
  }

  private normalizeSku(sku?: string | null): string | null {
    const normalized = sku?.trim();
    return normalized ? normalized : null;
  }

  private async getCompanyContext(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  private async ensureNoDuplicateProduct(
    companyId: string,
    name: string,
    hsnCode: string | null,
    excludeProductId?: string,
  ) {
    const duplicate = await this.prisma.product.findFirst({
      where: {
        companyId,
        deletedAt: null,
        id: excludeProductId ? { not: excludeProductId } : undefined,
        name: { equals: name, mode: 'insensitive' },
        hsnCode,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        'A product with the same name and HSN code already exists.',
      );
    }
  }

  async createProduct(companyId: string, dto: CreateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const company = await this.getCompanyContext(scopedCompanyId);
    const name = this.normalizeName(dto.name);
    const hsnCode = this.normalizeHsnCode(dto.hsnCode);
    const sku = this.normalizeSku(dto.searchCode);

    await this.ensureNoDuplicateProduct(scopedCompanyId, name, hsnCode);

    const product = await this.prisma.product.create({
      data: {
        tenantId: company.tenantId,
        companyId: scopedCompanyId,
        name,
        sku,
        unit: 'MTR',
        price: dto.retailPrice ?? dto.buyingPrice ?? 0,
        taxRate: dto.gstRate ?? 0,
        hsnCode,
      },
      select: PRODUCT_LIST_DEFAULT_SELECT,
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

    const where: Prisma.ProductWhereInput = { companyId: scopedCompanyId };

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { sku: { contains: options.search, mode: 'insensitive' } },
        { hsnCode: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    if (options?.isActive === true) {
      where.deletedAt = null;
    } else if (options?.isActive === false) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }

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
      select: PRODUCT_LIST_DEFAULT_SELECT,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async updateProduct(id: string, companyId: string, dto: UpdateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const existing = await this.findProductById(id, scopedCompanyId);

    const nextName = this.normalizeName(dto.name ?? existing.name);
    const nextHsn = this.normalizeHsnCode(dto.hsnCode ?? existing.hsnCode);
    await this.ensureNoDuplicateProduct(scopedCompanyId, nextName, nextHsn, id);

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name ? { name: nextName } : {}),
        ...(dto.searchCode !== undefined ? { sku: this.normalizeSku(dto.searchCode) } : {}),
        ...(dto.hsnCode !== undefined ? { hsnCode: nextHsn } : {}),
        ...(dto.retailPrice !== undefined ? { price: dto.retailPrice } : {}),
        ...(dto.gstRate !== undefined ? { taxRate: dto.gstRate } : {}),
        ...(dto.isActive === true ? { deletedAt: null } : {}),
        ...(dto.isActive === false ? { deletedAt: new Date() } : {}),
      },
      select: PRODUCT_LIST_DEFAULT_SELECT,
    });
  }

  async removeProduct(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    await this.findProductById(id, scopedCompanyId);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async removeProductPermanently(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    await this.findProductById(id, scopedCompanyId);

    try {
      return await this.prisma.product.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2003') {
        throw new ConflictException(
          'This product is linked to existing transactions and cannot be permanently deleted.',
        );
      }
      throw err;
    }
  }

  async createCategory(_companyId: string, _name: string) {
    throw new BadRequestException(
      'Product category APIs are deprecated because category model was removed from schema v2.',
    );
  }

  async findAllCategories(_companyId: string) {
    return [];
  }

  async updateCategory(_id: string, _companyId: string, _name: string) {
    throw new NotFoundException('Category not found');
  }

  async removeCategory(_id: string, _companyId: string) {
    throw new NotFoundException('Category not found');
  }

  async createBrand(_companyId: string, _name: string) {
    throw new BadRequestException(
      'Brand APIs are deprecated because brand model was removed from schema v2.',
    );
  }

  async findAllBrands(_companyId: string) {
    return [];
  }

  async updateBrand(_id: string, _companyId: string, _name: string) {
    throw new NotFoundException('Brand not found');
  }

  async removeBrand(_id: string, _companyId: string) {
    throw new NotFoundException('Brand not found');
  }

  async findAllUoms() {
    return [
      { id: 'MTR', name: 'MTR', fullName: 'Meter' },
      { id: 'KG', name: 'KG', fullName: 'Kilogram' },
      { id: 'PCS', name: 'PCS', fullName: 'Pieces' },
      { id: 'BOX', name: 'BOX', fullName: 'Box' },
    ];
  }

  async createUom(name: string, fullName?: string) {
    return {
      id: name.toUpperCase(),
      name: name.toUpperCase(),
      fullName: fullName ?? null,
      compatibilityNotice:
        'UOM persistence was removed with legacy models. Configure units via product.unit.',
    };
  }
}
