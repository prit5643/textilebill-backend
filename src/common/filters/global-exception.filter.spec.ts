import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

type HostMocks = {
  host: ArgumentsHost;
  responseStatus: jest.Mock;
  responseJson: jest.Mock;
};

function createHostMocks(path = '/test'): HostMocks {
  const responseJson = jest.fn();
  const responseStatus = jest.fn().mockReturnValue({ json: responseJson });

  const request = {
    method: 'GET',
    url: path,
    headers: {},
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: responseStatus }),
      getRequest: () => request,
    }),
  } as ArgumentsHost;

  return {
    host,
    responseStatus,
    responseJson,
  };
}

describe('GlobalExceptionFilter', () => {
  it('sanitizes technical internal messages before sending response', () => {
    const filter = new GlobalExceptionFilter();
    const { host, responseStatus, responseJson } = createHostMocks();

    const exception = new HttpException(
      'Database error. Please try again.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    filter.catch(exception, host);

    expect(responseStatus).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(responseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Our service is temporarily unavailable. Please try again shortly.',
      }),
    );
  });

  it('keeps non-technical business messages unchanged', () => {
    const filter = new GlobalExceptionFilter();
    const { host, responseJson } = createHostMocks();

    const exception = new HttpException(
      'Invalid credentials',
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, host);

    expect(responseJson).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid credentials' }),
    );
  });

  it('normalizes validation array messages to a friendly summary', () => {
    const filter = new GlobalExceptionFilter();
    const { host, responseJson } = createHostMocks();

    const exception = new HttpException(
      {
        message: ['name must not be empty'],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(responseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Please check your details and try again.',
        errors: ['name must not be empty'],
      }),
    );
  });
});
