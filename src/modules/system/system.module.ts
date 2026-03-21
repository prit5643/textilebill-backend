import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemReadinessService } from './system-readiness.service';
import { SystemReadyGuard } from './system-ready.guard';

@Module({
  controllers: [SystemController],
  providers: [SystemReadinessService, SystemReadyGuard],
  exports: [SystemReadinessService, SystemReadyGuard],
})
export class SystemModule {}
