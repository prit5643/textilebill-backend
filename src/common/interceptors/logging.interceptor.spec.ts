import { Logger } from '@nestjs/common';
import { catchError, lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function createHttpContext({
  statusCode = 200,
  requestOverrides = {},
}: {
  statusCode?: number;
  requestOverrides?: Record<string, unknown>;
}) {
  const request = {
    method: 'GET',
    url: '/api/auth/login',
    originalUrl: '/api/auth/login?source=test',
    baseUrl: '/api/auth',
    route: { path: '/login' },
    headers: {
      'x-request-id': 'req-1',
      'x-company-id': 'company-1',
    },
    user: { id: 'user-1' },
    companyId: 'company-1',
    ...requestOverrides,
  } as any;

  const response = {
    statusCode,
    setHeader: jest.fn(),
  } as any;

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;

  return { context, response };
}

describe('LoggingInterceptor', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs normalized request/route context and response time on success', async () => {
    const interceptor = new LoggingInterceptor(1500);
    const { context, response } = createHttpContext({ statusCode: 200 });
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(42);

    await lastValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ ok: true }),
      } as any),
    );

    expect(response.setHeader).toHaveBeenCalledWith('x-response-time-ms', '42');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"http_request"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"method":"GET"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"statusCode":200'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"requestId":"req-1"'),
    );
  });

  it('marks slow successful requests with a warning', async () => {
    const interceptor = new LoggingInterceptor(20);
    const { context } = createHttpContext({ statusCode: 200 });
    jest.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(45);

    await lastValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ ok: true }),
      } as any),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"slow":true'),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs failed requests as errors', async () => {
    const interceptor = new LoggingInterceptor(1500);
    const { context } = createHttpContext({ statusCode: 500 });
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(5);

    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => new Error('boom')),
        } as any),
      ),
    ).rejects.toThrow('boom');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"statusCode":500'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"hasError":true'),
    );
  });

  it('does not mark hasError=true when final status is successful', async () => {
    const interceptor = new LoggingInterceptor(1500);
    const { context } = createHttpContext({ statusCode: 200 });
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(7);

    await lastValueFrom(
      interceptor.intercept(context, {
        handle: () =>
          throwError(() => new Error('transient')).pipe(
            catchError(() => of({ recovered: true })),
          ),
      } as any),
    );

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"hasError":false'),
    );
  });
});
