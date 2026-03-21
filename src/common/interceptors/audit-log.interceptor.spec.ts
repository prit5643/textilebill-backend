import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';

describe('AuditLogInterceptor', () => {
  it('writes tenant-aware audit metadata for mutating requests', (done) => {
    const create = jest.fn().mockResolvedValue({});
    const interceptor = new AuditLogInterceptor({
      auditLog: { create },
    } as any);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          companyId: 'company-1',
          user: { id: 'user-1', tenantId: 'tenant-1' },
          headers: { 'user-agent': 'jest' },
          ip: '127.0.0.1',
          params: {},
          res: { locals: {} },
        }),
      }),
      getClass: () => ({ name: 'InvoiceController' }),
      getHandler: () => ({ name: 'create' }),
    } as any;

    const next = {
      handle: () => of({ id: 'invoice-1' }),
    } as any;

    interceptor.intercept(context, next).subscribe({
      next: () => {
        setImmediate(() => {
          expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                tenantId: 'tenant-1',
                companyId: 'company-1',
                userId: 'user-1',
                entity: 'Invoice',
                entityId: 'invoice-1',
              }),
            }),
          );
          done();
        });
      },
    });
  });
});
