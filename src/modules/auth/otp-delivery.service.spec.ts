import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { OtpDeliveryService } from './otp-delivery.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  createTransport: jest.fn(),
  default: {
    createTransport: jest.fn(),
  },
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
      '[OTP:LOGIN] delivery fallback -> channel=EMAIL, target=ow***@test.com, otp=123456',
    );

    loggerSpy.mockRestore();
  });

  it('sends OTP email through nodemailer when SMTP is enabled', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'mail-1' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return {
          enabled: true,
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'mailer',
          password: 'secret',
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

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'mailer',
          pass: 'secret',
        },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'billing@test.com',
        to: 'owner@test.com',
        subject: 'TextileBill Email Verification OTP',
      }),
    );
  });

  it('sends OTP email through Gmail transport when configured', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'gmail-mail-1' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    configService.get.mockImplementation((key: string) => {
      if (key === 'mail') {
        return {
          enabled: true,
          transport: 'gmail',
          gmailUser: 'owner@gmail.com',
          gmailAppPassword: 'gmail-app-password',
          gmailFrom: 'TextileBill <owner@gmail.com>',
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

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'gmail',
        auth: {
          user: 'owner@gmail.com',
          pass: 'gmail-app-password',
        },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'TextileBill <owner@gmail.com>',
        to: 'owner@test.com',
        subject: 'TextileBill Login OTP',
      }),
    );
  });

  it('throws when SMTP delivery fails, even in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const sendMail = jest.fn().mockRejectedValue(new Error('SMTP offline'));
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

      configService.get.mockImplementation((key: string) => {
        if (key === 'mail') {
          return {
            enabled: true,
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            user: 'mailer',
            password: 'secret',
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
          purpose: 'PASSWORD_RESET',
          maskedTarget: 'ow***@test.com',
        }),
      ).rejects.toThrow('SMTP offline');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

});
