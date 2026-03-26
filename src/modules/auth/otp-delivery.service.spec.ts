import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { OtpDeliveryService } from './otp-delivery.service';

const resendSendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: resendSendMock,
    },
  })),
}));

describe('OtpDeliveryService', () => {
  let service: OtpDeliveryService;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn() };
    service = new OtpDeliveryService(configService as unknown as ConfigService);
    jest.clearAllMocks();
  });

  it('uses the log fallback when email delivery is disabled', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return { enabled: false };
      }

      return undefined;
    });

    await expect(
      service.deliver({
        channel: 'EMAIL',
        target: 'owner@test.com',
        otp: '123456',
        purpose: 'LOGIN',
        maskedTarget: 'ow***@test.com',
      }),
    ).resolves.toBe(true);

    expect(loggerSpy).toHaveBeenCalledWith(
      '[OTP:LOGIN] Dev mode -> channel=EMAIL, target=ow***@test.com, otp=123456',
    );

    loggerSpy.mockRestore();
  });

  it('sends OTP email through resend when mail is enabled', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'mail-1' }, error: null });

    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return {
          enabled: true,
          resendApiKey: 're_123',
          resendFrom: 'TextileBill <billing@test.com>',
          from: 'billing@test.com',
        };
      }

      return undefined;
    });

    await expect(
      service.deliver({
        channel: 'EMAIL',
        target: 'owner@test.com',
        otp: '123456',
        purpose: 'VERIFY_EMAIL',
        maskedTarget: 'ow***@test.com',
      }),
    ).resolves.toBe(true);

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'TextileBill <billing@test.com>',
        to: 'owner@test.com',
        subject: 'TextileBill Email Verification OTP',
      }),
    );
  });

  it('sends invite email through resend when mail is enabled', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'mail-2' }, error: null });

    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return {
          enabled: true,
          resendApiKey: 're_123',
          resendFrom: 'TextileBill <owner@test.com>',
          resendReplyTo: 'support@test.com',
        };
      }

      return undefined;
    });

    await expect(
      service.deliver({
        channel: 'EMAIL',
        target: 'owner@test.com',
        otp: '123456',
        purpose: 'LOGIN',
        maskedTarget: 'ow***@test.com',
      }),
    ).resolves.toBe(true);

    await expect(
      service.sendInviteEmail('owner@test.com', 'https://example.com/invite'),
    ).resolves.toBe(true);
  });

  it('throws when resend delivery fails, even in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      resendSendMock.mockRejectedValue(new Error('Resend offline'));

      configService.get.mockImplementation((key: string) => {
        if (key === 'mail') {
          return {
            enabled: true,
            resendApiKey: 're_123',
            resendFrom: 'TextileBill <billing@test.com>',
          };
        }

        return undefined;
      });

      await expect(
        service.deliver({
          channel: 'EMAIL',
          target: 'owner@test.com',
          otp: '123456',
          purpose: 'PASSWORD_RESET',
          maskedTarget: 'ow***@test.com',
        }),
      ).rejects.toThrow('Resend offline');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('throws when resend configuration is missing', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return {
          enabled: true,
          resendApiKey: '',
          resendFrom: '',
        };
      }

      return undefined;
    });

    await expect(
      service.deliver({
        channel: 'EMAIL',
        target: 'owner@test.com',
        otp: '123456',
        purpose: 'PASSWORD_RESET',
        maskedTarget: 'ow***@test.com',
      }),
    ).rejects.toThrow('Resend configuration is incomplete');
  });
});
