import { createPaginatedResult, parsePagination } from './pagination.util';

describe('pagination.util', () => {
  it('normalizes page and limit inputs', () => {
    expect(parsePagination({ page: 0, limit: 999 })).toEqual({
      skip: 0,
      take: 500,
      page: 1,
      limit: 500,
    });
  });

  it('returns a stable meta shape for empty result sets', () => {
    expect(createPaginatedResult([], 0, 1, 50)).toEqual({
      data: [],
      meta: {
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    });
  });
});
