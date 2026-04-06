import { of } from "rxjs";
import { AuditLogInterceptor } from "./audit-log.interceptor";

describe("AuditLogInterceptor", () => {
  it("persists an audit row for mutating requests", (done) => {
    const prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "log-1" }),
      },
    } as any;

    const interceptor = new AuditLogInterceptor(prisma);

    const context = {
      getType: () => "http",
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          originalUrl: "/api/admin/users",
          url: "/api/admin/users",
          baseUrl: "/api/admin",
          route: { path: "/users" },
          params: { id: "user-1" },
          body: { email: "new@test.com", password: "secret" },
          headers: { "user-agent": "jest" },
          ip: "127.0.0.1",
          user: { id: "actor-1", tenantId: "tenant-1" },
          companyId: "company-1",
        }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as any;

    const next = {
      handle: () => of({ id: "invoice-1" }),
    } as any;

    interceptor.intercept(context, next).subscribe({
      next: (val) => {
        expect(val).toEqual({ id: "invoice-1" });

        setImmediate(() => {
          expect(prisma.auditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                userId: "actor-1",
                tenantId: "tenant-1",
                companyId: "company-1",
                method: "POST",
                statusCode: 201,
              }),
            }),
          );
          done();
        });
      },
    });
  });
});