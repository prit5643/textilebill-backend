import { verifyGstinSafe } from './gst-circuit-breaker.util';
import axios from 'axios';
import { HttpException, HttpStatus } from '@nestjs/common';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GST Circuit Breaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return data successfully if the API is up', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { valid: true, gstin: '27AASCS2460H1Z0' },
    });

    const result = await verifyGstinSafe('27AASCS2460H1Z0');
    expect(result).toEqual({ valid: true, gstin: '27AASCS2460H1Z0' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('should map 400 validation errors to a user-friendly message', async () => {
    // Mocking an axios error response for a Bad Request
    const errorResponse = {
      response: {
        status: 400,
        data: { message: 'Invalid GSTIN format' },
      },
    };
    mockedAxios.get.mockRejectedValueOnce(errorResponse);

    try {
      await verifyGstinSafe('INVALID_GSTIN');
      fail('Expected exception was not thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(e.message).toBe(
        'The GSTIN you entered seems invalid. Please check and try again.',
      );
    }
  });

  it('should throw 502 Bad Gateway if the API returns 500 Network Error', async () => {
    const errorResponse = {
      response: {
        status: 500,
        data: { message: 'Internal Server Error' },
      },
      message: 'Network Error',
    };
    mockedAxios.get.mockRejectedValueOnce(errorResponse);

    try {
      await verifyGstinSafe('27AASCS2460H1Z0');
      fail('Expected exception was not thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(e.message).toBe('Failed to verify GSTIN. External service error.');
    }
  });
});
