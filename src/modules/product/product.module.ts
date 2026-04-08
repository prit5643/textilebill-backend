import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ClassificationController } from './classification.controller';
import { CardTypeController } from './card-type.controller';
import { CategoryController } from './category.controller';
import { ServiceCategoryController } from './service-category.controller';
import { BrandController } from './brand.controller';
import { UomController } from './uom.controller';

@Module({
  controllers: [
    ProductController,
    ClassificationController,
    CardTypeController,
    CategoryController,
    ServiceCategoryController,
    BrandController,
    UomController,
  ],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
