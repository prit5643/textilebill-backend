import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../src/modules/auth/auth.controller';

function getRouteParamMetadata(
  target: any,
  methodName: keyof AuthController,
): Record<string, { data?: unknown }> {
  return (
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target[methodName]) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, methodName) ??
    Reflect.getMetadata(ROUTE_ARGS_METADATA, target, methodName) ??
    {}
  );
}

describe('Auth route contract (e2e)', () => {
  it('binds the authenticated user id on change-password', () => {
    const metadata = getRouteParamMetadata(
      AuthController.prototype,
      'changePassword',
    );

    expect(Object.values(metadata).some((entry) => entry?.data === 'id')).toBe(
      true,
    );
  });

  it('accepts cookie-driven refresh/logout flows without requiring a DTO body', () => {
    expect(AuthController.prototype.refresh.length).toBeGreaterThanOrEqual(2);
    expect(AuthController.prototype.logout.length).toBeGreaterThanOrEqual(2);
  });

  it('binds the authenticated user id on session routes', () => {
    const getSessionsMetadata = getRouteParamMetadata(
      AuthController.prototype,
      'getSessions',
    );
    const revokeSessionMetadata = getRouteParamMetadata(
      AuthController.prototype,
      'revokeSession',
    );

    expect(
      Object.values(getSessionsMetadata).some((entry) => entry?.data === 'id'),
    ).toBe(true);
    expect(
      Object.values(revokeSessionMetadata).some(
        (entry) => entry?.data === 'id',
      ),
    ).toBe(true);
  });
});
