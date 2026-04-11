import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  GstConsiderAs,
  Prisma,
  ProductOptionKind,
  ProductType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  parsePagination,
  createPaginatedResult,
} from '../../common/utils/pagination.util';

type ProductListView = 'default' | 'selector';

const PRODUCT_OPTION_BASE_SELECT = {
  id: true,
  companyId: true,
  name: true,
} satisfies Prisma.ProductOptionSelect;

const PRODUCT_OPTION_UOM_SELECT = {
  ...PRODUCT_OPTION_BASE_SELECT,
  fullName: true,
  isDefault: true,
} satisfies Prisma.ProductOptionSelect;

const PRODUCT_LIST_DEFAULT_SELECT = {
  id: true,
  tenantId: true,
  companyId: true,
  name: true,
  sku: true,
  description: true,
  unit: true,
  hsnCode: true,
  price: true,
  buyingPrice: true,
  mrp: true,
  wholesalerPrice: true,
  distributorPrice: true,
  taxRate: true,
  type: true,
  gstConsiderAs: true,
  classificationId: true,
  cardTypeId: true,
  categoryId: true,
  serviceCategoryId: true,
  brandId: true,
  uomId: true,
  defaultQty: true,
  defaultDiscount: true,
  minimumQty: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  classification: { select: PRODUCT_OPTION_BASE_SELECT },
  cardType: { select: PRODUCT_OPTION_BASE_SELECT },
  category: { select: PRODUCT_OPTION_BASE_SELECT },
  serviceCategory: { select: PRODUCT_OPTION_BASE_SELECT },
  brand: { select: PRODUCT_OPTION_BASE_SELECT },
  uom: { select: PRODUCT_OPTION_UOM_SELECT },
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

const DEFAULT_UOMS = [
  { name: 'MTR', fullName: 'Meter' },
  { name: 'KG', fullName: 'Kilogram' },
  { name: 'PCS', fullName: 'Pieces' },
  { name: 'BOX', fullName: 'Box' },
] as const;

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

  private normalizeNullableText(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeHsnCode(hsnCode?: string | null): string | null {
    return this.normalizeNullableText(hsnCode);
  }

  private normalizeSku(sku?: string | null): string | null {
    return this.normalizeNullableText(sku);
  }

  private normalizeOptionName(
    kind: ProductOptionKind,
    name?: string | null,
  ): string {
    const normalized = (name ?? '').trim();
    return kind === ProductOptionKind.UOM
      ? normalized.toUpperCase()
      : normalized;
  }

  private normalizeProductType(value?: string | null): ProductType | undefined {
    if (!value) return undefined;
    return Object.values(ProductType).includes(value as ProductType)
      ? (value as ProductType)
      : undefined;
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

  private async ensureDefaultUoms(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const company = await this.getCompanyContext(scopedCompanyId);

    const existing = await this.prisma.productOption.findMany({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.UOM,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });

    const existingNames = new Set(
      existing.map((option) => option.name.toUpperCase()),
    );
    const missingDefaults = DEFAULT_UOMS.filter(
      (uom) => !existingNames.has(uom.name),
    );

    if (missingDefaults.length > 0) {
      await this.prisma.productOption.createMany({
        data: missingDefaults.map((uom) => ({
          tenantId: company.tenantId,
          companyId: scopedCompanyId,
          kind: ProductOptionKind.UOM,
          name: uom.name,
          fullName: uom.fullName,
          isDefault: true,
        })),
      });
    }
  }

  private async ensureProductOption(
    companyId: string,
    kind: ProductOptionKind,
    optionId?: string | null,
  ) {
    if (optionId === undefined) {
      return undefined;
    }

    const normalizedId = optionId?.trim();
    if (!normalizedId) {
      return null;
    }

    if (kind === ProductOptionKind.UOM) {
      await this.ensureDefaultUoms(companyId);
    }

    const option = await this.prisma.productOption.findFirst({
      where: {
        id: normalizedId,
        companyId,
        kind,
        deletedAt: null,
      },
      select:
        kind === ProductOptionKind.UOM
          ? PRODUCT_OPTION_UOM_SELECT
          : PRODUCT_OPTION_BASE_SELECT,
    });

    if (!option) {
      throw new NotFoundException(
        `${kind.toLowerCase()} option was not found for this company.`,
      );
    }

    return option;
  }

  private async findOrCreateProductOption(
    companyId: string,
    kind: ProductOptionKind,
    name: string,
    fullName?: string | null,
  ) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.normalizeOptionName(kind, name);
    if (!normalizedName) {
      throw new BadRequestException(`${kind.toLowerCase()} name is required`);
    }

    if (kind === ProductOptionKind.UOM) {
      await this.ensureDefaultUoms(scopedCompanyId);
    }

    const existing = await this.prisma.productOption.findFirst({
      where: {
        companyId: scopedCompanyId,
        kind,
        deletedAt: null,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      select:
        kind === ProductOptionKind.UOM
          ? PRODUCT_OPTION_UOM_SELECT
          : PRODUCT_OPTION_BASE_SELECT,
    });

    if (existing) {
      if (
        kind === ProductOptionKind.UOM &&
        fullName &&
        'fullName' in existing &&
        !existing.fullName
      ) {
        return this.prisma.productOption.update({
          where: { id: existing.id },
          data: { fullName: this.normalizeNullableText(fullName) },
          select: PRODUCT_OPTION_UOM_SELECT,
        });
      }
      return existing;
    }

    const company = await this.getCompanyContext(scopedCompanyId);

    return this.prisma.productOption.create({
      data: {
        tenantId: company.tenantId,
        companyId: scopedCompanyId,
        kind,
        name: normalizedName,
        fullName:
          kind === ProductOptionKind.UOM
            ? this.normalizeNullableText(fullName)
            : null,
        isDefault: false,
      },
      select:
        kind === ProductOptionKind.UOM
          ? PRODUCT_OPTION_UOM_SELECT
          : PRODUCT_OPTION_BASE_SELECT,
    });
  }

  private async getDefaultUom(companyId: string) {
    await this.ensureDefaultUoms(companyId);
    const option = await this.prisma.productOption.findFirst({
      where: {
        companyId,
        kind: ProductOptionKind.UOM,
        deletedAt: null,
        name: 'MTR',
      },
      select: PRODUCT_OPTION_UOM_SELECT,
    });

    if (!option) {
      throw new NotFoundException('Default unit of measurement was not found.');
    }

    return option;
  }

  async createProduct(companyId: string, dto: CreateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const company = await this.getCompanyContext(scopedCompanyId);
    const name = this.normalizeName(dto.name);
    const hsnCode = this.normalizeHsnCode(dto.hsnCode);
    const sku = this.normalizeSku(dto.searchCode);

    await this.ensureNoDuplicateProduct(scopedCompanyId, name, hsnCode);

    const [
      classification,
      cardType,
      category,
      serviceCategory,
      brand,
      explicitUom,
    ] = await Promise.all([
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.CLASSIFICATION,
        dto.classificationId,
      ),
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.CARD_TYPE,
        dto.cardTypeId,
      ),
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.CATEGORY,
        dto.categoryId,
      ),
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.SERVICE_CATEGORY,
        dto.serviceCategoryId,
      ),
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.BRAND,
        dto.brandId,
      ),
      this.ensureProductOption(
        scopedCompanyId,
        ProductOptionKind.UOM,
        dto.uomId,
      ),
    ]);

    const uom = explicitUom ?? (await this.getDefaultUom(scopedCompanyId));

    const product = await this.prisma.product.create({
      data: {
        tenantId: company.tenantId,
        companyId: scopedCompanyId,
        name,
        sku,
        description: this.normalizeNullableText(dto.description),
        unit: uom.name,
        price: dto.retailPrice ?? dto.buyingPrice ?? 0,
        buyingPrice: dto.buyingPrice ?? null,
        mrp: dto.mrp ?? null,
        wholesalerPrice: dto.wholesalerPrice ?? null,
        distributorPrice: dto.distributorPrice ?? null,
        taxRate: dto.gstRate ?? 0,
        type: dto.type ?? ProductType.GOODS,
        gstConsiderAs: dto.gstConsiderAs ?? GstConsiderAs.TAXABLE,
        hsnCode,
        classificationId: classification?.id ?? null,
        cardTypeId: cardType?.id ?? null,
        categoryId: category?.id ?? null,
        serviceCategoryId: serviceCategory?.id ?? null,
        brandId: brand?.id ?? null,
        uomId: uom.id,
        defaultQty: dto.defaultQty ?? null,
        defaultDiscount: dto.defaultDiscount ?? null,
        minimumQty: dto.minimumQty ?? null,
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
        {
          classification: {
            is: { name: { contains: options.search, mode: 'insensitive' } },
          },
        },
        {
          cardType: {
            is: { name: { contains: options.search, mode: 'insensitive' } },
          },
        },
        {
          category: {
            is: { name: { contains: options.search, mode: 'insensitive' } },
          },
        },
        {
          serviceCategory: {
            is: { name: { contains: options.search, mode: 'insensitive' } },
          },
        },
        {
          brand: {
            is: { name: { contains: options.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (options?.categoryId) {
      where.categoryId = options.categoryId;
    }

    if (options?.brandId) {
      where.brandId = options.brandId;
    }

    const normalizedType = this.normalizeProductType(options?.type);
    if (normalizedType) {
      where.type = normalizedType;
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
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async updateProduct(id: string, companyId: string, dto: UpdateProductDto) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const existing = await this.findProductById(id, scopedCompanyId);

    const nextName = this.normalizeName(dto.name ?? existing.name);
    const nextHsn = this.normalizeHsnCode(dto.hsnCode ?? existing.hsnCode);
    await this.ensureNoDuplicateProduct(scopedCompanyId, nextName, nextHsn, id);

    const [classification, cardType, category, serviceCategory, brand, uom] =
      await Promise.all([
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.CLASSIFICATION,
          dto.classificationId,
        ),
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.CARD_TYPE,
          dto.cardTypeId,
        ),
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.CATEGORY,
          dto.categoryId,
        ),
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.SERVICE_CATEGORY,
          dto.serviceCategoryId,
        ),
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.BRAND,
          dto.brandId,
        ),
        this.ensureProductOption(
          scopedCompanyId,
          ProductOptionKind.UOM,
          dto.uomId,
        ),
      ]);

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: nextName } : {}),
        ...(dto.searchCode !== undefined
          ? { sku: this.normalizeSku(dto.searchCode) }
          : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeNullableText(dto.description) }
          : {}),
        ...(dto.hsnCode !== undefined ? { hsnCode: nextHsn } : {}),
        ...(dto.retailPrice !== undefined ? { price: dto.retailPrice } : {}),
        ...(dto.buyingPrice !== undefined
          ? { buyingPrice: dto.buyingPrice ?? null }
          : {}),
        ...(dto.mrp !== undefined ? { mrp: dto.mrp ?? null } : {}),
        ...(dto.wholesalerPrice !== undefined
          ? { wholesalerPrice: dto.wholesalerPrice ?? null }
          : {}),
        ...(dto.distributorPrice !== undefined
          ? { distributorPrice: dto.distributorPrice ?? null }
          : {}),
        ...(dto.gstRate !== undefined ? { taxRate: dto.gstRate } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.gstConsiderAs !== undefined
          ? { gstConsiderAs: dto.gstConsiderAs }
          : {}),
        ...(dto.classificationId !== undefined
          ? { classificationId: classification?.id ?? null }
          : {}),
        ...(dto.cardTypeId !== undefined
          ? { cardTypeId: cardType?.id ?? null }
          : {}),
        ...(dto.categoryId !== undefined
          ? { categoryId: category?.id ?? null }
          : {}),
        ...(dto.serviceCategoryId !== undefined
          ? { serviceCategoryId: serviceCategory?.id ?? null }
          : {}),
        ...(dto.brandId !== undefined ? { brandId: brand?.id ?? null } : {}),
        ...(dto.uomId !== undefined
          ? {
              uomId: uom?.id ?? null,
              unit: uom?.name ?? existing.unit,
            }
          : {}),
        ...(dto.defaultQty !== undefined
          ? { defaultQty: dto.defaultQty ?? null }
          : {}),
        ...(dto.defaultDiscount !== undefined
          ? { defaultDiscount: dto.defaultDiscount ?? null }
          : {}),
        ...(dto.minimumQty !== undefined
          ? { minimumQty: dto.minimumQty ?? null }
          : {}),
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

  private async listProductOptionsByKind(
    companyId: string,
    kind: ProductOptionKind,
  ) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    return this.prisma.productOption.findMany({
      where: {
        companyId: scopedCompanyId,
        kind,
        deletedAt: null,
      },
      select: PRODUCT_OPTION_BASE_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  private async updateProductOptionName(
    id: string,
    companyId: string,
    kind: ProductOptionKind,
    name: string,
    notFoundMessage: string,
    duplicateMessage: string,
    requiredMessage: string,
  ) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.normalizeOptionName(kind, name);
    if (!normalizedName) {
      throw new BadRequestException(requiredMessage);
    }

    const duplicate = await this.prisma.productOption.findFirst({
      where: {
        companyId: scopedCompanyId,
        kind,
        deletedAt: null,
        id: { not: id },
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(duplicateMessage);
    }

    const option = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!option) {
      throw new NotFoundException(notFoundMessage);
    }

    return this.prisma.productOption.update({
      where: { id },
      data: { name: normalizedName },
      select: PRODUCT_OPTION_BASE_SELECT,
    });
  }

  private async removeProductOption(
    id: string,
    companyId: string,
    kind: ProductOptionKind,
    notFoundMessage: string,
  ) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const option = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!option) {
      throw new NotFoundException(notFoundMessage);
    }

    await this.prisma.productOption.delete({ where: { id } });
    return { success: true };
  }

  async createClassification(companyId: string, name: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.CLASSIFICATION,
      name,
    );
  }

  async findAllClassifications(companyId: string) {
    return this.listProductOptionsByKind(
      companyId,
      ProductOptionKind.CLASSIFICATION,
    );
  }

  async updateClassification(id: string, companyId: string, name: string) {
    return this.updateProductOptionName(
      id,
      companyId,
      ProductOptionKind.CLASSIFICATION,
      name,
      'Classification not found',
      'Classification already exists',
      'Classification name is required',
    );
  }

  async removeClassification(id: string, companyId: string) {
    return this.removeProductOption(
      id,
      companyId,
      ProductOptionKind.CLASSIFICATION,
      'Classification not found',
    );
  }

  async createCardType(companyId: string, name: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.CARD_TYPE,
      name,
    );
  }

  async findAllCardTypes(companyId: string) {
    return this.listProductOptionsByKind(
      companyId,
      ProductOptionKind.CARD_TYPE,
    );
  }

  async updateCardType(id: string, companyId: string, name: string) {
    return this.updateProductOptionName(
      id,
      companyId,
      ProductOptionKind.CARD_TYPE,
      name,
      'Card type not found',
      'Card type already exists',
      'Card type name is required',
    );
  }

  async removeCardType(id: string, companyId: string) {
    return this.removeProductOption(
      id,
      companyId,
      ProductOptionKind.CARD_TYPE,
      'Card type not found',
    );
  }

  async createCategory(companyId: string, name: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.CATEGORY,
      name,
    );
  }

  async findAllCategories(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    return this.prisma.productOption.findMany({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.CATEGORY,
        deletedAt: null,
      },
      select: PRODUCT_OPTION_BASE_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  async updateCategory(id: string, companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.normalizeOptionName(
      ProductOptionKind.CATEGORY,
      name,
    );
    if (!normalizedName) {
      throw new BadRequestException('Category name is required');
    }

    const duplicate = await this.prisma.productOption.findFirst({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.CATEGORY,
        deletedAt: null,
        id: { not: id },
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Category already exists');
    }

    const category = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind: ProductOptionKind.CATEGORY,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.prisma.productOption.update({
      where: { id },
      data: { name: normalizedName },
      select: PRODUCT_OPTION_BASE_SELECT,
    });
  }

  async removeCategory(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const category = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind: ProductOptionKind.CATEGORY,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    await this.prisma.productOption.delete({ where: { id } });
    return { success: true };
  }

  async createServiceCategory(companyId: string, name: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.SERVICE_CATEGORY,
      name,
    );
  }

  async findAllServiceCategories(companyId: string) {
    return this.listProductOptionsByKind(
      companyId,
      ProductOptionKind.SERVICE_CATEGORY,
    );
  }

  async updateServiceCategory(id: string, companyId: string, name: string) {
    return this.updateProductOptionName(
      id,
      companyId,
      ProductOptionKind.SERVICE_CATEGORY,
      name,
      'Service category not found',
      'Service category already exists',
      'Service category name is required',
    );
  }

  async removeServiceCategory(id: string, companyId: string) {
    return this.removeProductOption(
      id,
      companyId,
      ProductOptionKind.SERVICE_CATEGORY,
      'Service category not found',
    );
  }

  async createBrand(companyId: string, name: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.BRAND,
      name,
    );
  }

  async findAllBrands(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    return this.prisma.productOption.findMany({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.BRAND,
        deletedAt: null,
      },
      select: PRODUCT_OPTION_BASE_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  async updateBrand(id: string, companyId: string, name: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const normalizedName = this.normalizeOptionName(
      ProductOptionKind.BRAND,
      name,
    );
    if (!normalizedName) {
      throw new BadRequestException('Brand name is required');
    }

    const duplicate = await this.prisma.productOption.findFirst({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.BRAND,
        deletedAt: null,
        id: { not: id },
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Brand already exists');
    }

    const brand = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind: ProductOptionKind.BRAND,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return this.prisma.productOption.update({
      where: { id },
      data: { name: normalizedName },
      select: PRODUCT_OPTION_BASE_SELECT,
    });
  }

  async removeBrand(id: string, companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    const brand = await this.prisma.productOption.findFirst({
      where: {
        id,
        companyId: scopedCompanyId,
        kind: ProductOptionKind.BRAND,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    await this.prisma.productOption.delete({ where: { id } });
    return { success: true };
  }

  async findAllUoms(companyId: string) {
    const scopedCompanyId = this.requireCompanyId(companyId);
    await this.ensureDefaultUoms(scopedCompanyId);
    return this.prisma.productOption.findMany({
      where: {
        companyId: scopedCompanyId,
        kind: ProductOptionKind.UOM,
        deletedAt: null,
      },
      select: PRODUCT_OPTION_UOM_SELECT,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createUom(companyId: string, name: string, fullName?: string) {
    return this.findOrCreateProductOption(
      companyId,
      ProductOptionKind.UOM,
      name,
      fullName,
    );
  }
}
