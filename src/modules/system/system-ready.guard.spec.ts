import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { SystemReadyGuard } from './system-ready.guard';
import {
  ReadinessSnapshot,
  SystemReadinessService,
} from './system-readiness.service';

const createContext = (path: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () =>
        ({
          path,
          url: path,
        }) as Request,
    }),
  }) as ExecutionContext;

describe('SystemReadyGuard', () => {
  const createReadiness = (snapshot: ReadinessSnapshot) =>
    ({
      check: jest.fn().mockResolvedValue(snapshot),
    }) as unknown as SystemReadinessService;

  it.each([
    '/health',
    '/api/health',
    '/system/health',
    '/api/system/health',
    '/system/readiness',
    '/api/system/readiness',
  ])('bypasses readiness check for %s', async (path) => {
    const readiness = createReadiness({ ready: false, checkedAt: null });
    const guard = new SystemReadyGuard(readiness);

    await expect(guard.canActivate(createContext(path))).resolves.toBe(true);
    expect(readiness.check).not.toHaveBeenCalled();
  });

  it('checks readiness for non-excluded paths', async () => {
    const readiness = createReadiness({ ready: true, checkedAt: null });
    const guard = new SystemReadyGuard(readiness);

    await expect(
      guard.canActivate(createContext('/api/products')),
    ).resolves.toBe(true);
    expect(readiness.check).toHaveBeenCalledWith(false);
  });

  it('throws service unavailable when the system is not ready', async () => {
    const readiness = createReadiness({ ready: false, checkedAt: null });
    const guard = new SystemReadyGuard(readiness);

    await expect(
      guard.canActivate(createContext('/api/products')),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
