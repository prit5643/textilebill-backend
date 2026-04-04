import { of } from "rxjs";
import { AuditLogInterceptor } from "./audit-log.interceptor";

describe("AuditLogInterceptor", () => {
  it("passes through since AuditLog model is removed in v2 schema", (done) => {
    const interceptor = new AuditLogInterceptor({} as any);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST" }),
      }),
    } as any;

    const next = {
      handle: () => of({ id: "invoice-1" }),
    } as any;

    interceptor.intercept(context, next).subscribe({
      next: (val) => {
        expect(val).toEqual({ id: "invoice-1" });
        done();
      },
    });
  });
});