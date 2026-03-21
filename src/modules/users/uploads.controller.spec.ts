import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UploadsController } from './uploads.controller';

describe('UploadsController', () => {
  let controller: UploadsController;

  beforeEach(() => {
    controller = new UploadsController();
  });

  it('rejects invalid avatar filenames', () => {
    expect(() =>
      controller.serveAvatar('../etc/passwd', {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      } as any),
    ).toThrow(BadRequestException);
  });

  it('returns not-found for missing avatar files with valid filenames', () => {
    expect(() =>
      controller.serveAvatar('user-1700000000000.jpg', {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      } as any),
    ).toThrow(NotFoundException);
  });
});
