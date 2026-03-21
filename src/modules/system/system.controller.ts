import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemReadinessService } from './system-readiness.service';

@ApiTags('System')
@Controller('system')
export class SystemController {
  constructor(private readonly readiness: SystemReadinessService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe' })
  async readinessStatus() {
    const snapshot = await this.readiness.check(false);
    if (!snapshot.ready) {
      throw new ServiceUnavailableException('Database migration required');
    }

    return {
      status: 'ready',
      checkedAt: snapshot.checkedAt,
    };
  }
}
