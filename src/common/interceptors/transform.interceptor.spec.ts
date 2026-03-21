import { of, lastValueFrom } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  it('wraps plain payloads in the canonical API envelope', async () => {
    const interceptor = new TransformInterceptor();

    const result = await lastValueFrom(
      interceptor.intercept(
        {} as any,
        {
          handle: () => of({ message: 'ok' }),
        } as any,
      ),
    );

    expect(result).toEqual({
      data: { message: 'ok' },
      meta: {
        timestamp: expect.any(String),
      },
    });
  });

  it('passes through already-normalized paginated responses', async () => {
    const interceptor = new TransformInterceptor();
    const payload = {
      data: [{ id: 'inv-1' }],
      meta: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };

    const result = await lastValueFrom(
      interceptor.intercept(
        {} as any,
        {
          handle: () => of(payload),
        } as any,
      ),
    );

    expect(result).toEqual(payload);
  });
});
