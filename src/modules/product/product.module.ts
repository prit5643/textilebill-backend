import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { CategoryController } from './category.controller';
import { BrandController } from './brand.controller';
import { UomController } from './uom.controller';

@Module({
  controllers: [
    ProductController,
    CategoryController,
    BrandController,
    UomController,
  ],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
