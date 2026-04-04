import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: any;

  const configService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      switch (key) {
        case 'app.url':
          return 'http://localhost:3000';
        case 'app.apiPrefix':
          return 'api/v1';
        case 'jwt.expiresIn':
          return '15m';
        case 'jwt.refreshExpiresIn':
          return '7d';
        case 'app.cookieSameSite':
          return 'lax';
        case 'app.cookieSecure':
          return 'false';
        case 'app.nodeEnv':
          return 'test';
        default:
          return defaultValue;
      }
    }),
  } as unknown as ConfigService;

  const createResponse = () =>
    ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as any;

  beforeEach(() => {
    authService = {
      getCurrentSession: jest.fn(),
      login: jest.fn(),
      requestLoginOtp: jest.fn(),
      verifyLoginOtp: jest.fn(),
      acceptInvite: jest.fn(),
      resendOtp: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      changePassword: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      getVerificationStatus: jest.fn(),
      requestContactVerification: jest.fn(),
      verifyContactOtp: jest.fn(),
      requestPasswordResetLink: jest.fn(),
      validatePasswordResetToken: jest.fn(),
      resetPasswordWithLink: jest.fn(),
      validateInviteToken: jest.fn(),
      validatePasswordSetupToken: jest.fn(),
      resendPasswordSetupLink: jest.fn(),
      getUserSessions: jest.fn(),
      revokeSession: jest.fn(),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      configService,
    );
  });

  it('returns current session payload from getMe', async () => {
    authService.getCurrentSession.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'owner@test.com' },
    });

    await expect(controller.getMe('user-1')).resolves.toEqual({
      user: { id: 'user-1', email: 'owner@test.com' },
    });

    expect(authService.getCurrentSession).toHaveBeenCalledWith('user-1');
  });

  it('sets auth cookies on login and omits tokens in response body', async () => {
    const response = createResponse();

    authService.login.mockResolvedValueOnce({
      accessToken: 'access-token',
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'owner@test.com' },
    });

    const result = await controller.login(
      { headers: { origin: 'http://localhost:3000' } } as any,
      response,
      { username: 'owner@test.com', password: 'Password1!' },
    );

    expect(authService.login).toHaveBeenCalledWith(
      { username: 'owner@test.com', password: 'Password1!' },
      expect.objectContaining({ deviceId: null }),
    );
    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ user: { id: 'user-1', email: 'owner@test.com' } });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('refreshes using cookie token and rotates cookies', async () => {
    const response = createResponse();
    authService.refreshTokens.mockResolvedValueOnce({
      accessToken: 'next-access',
      sessionToken: 'next-session',
      refreshToken: 'next-refresh',
    });

    await expect(
      controller.refresh(
        {
          headers: {
            origin: 'http://localhost:3000',
            cookie: 'tb_refresh=refresh-token-1',
          },
        } as any,
        response,
      ),
    ).resolves.toEqual({ refreshed: true });

    expect(authService.refreshTokens).toHaveBeenCalledWith(
      'refresh-token-1',
      expect.objectContaining({ deviceId: null }),
    );
    expect(response.cookie).toHaveBeenCalledTimes(3);
  });

  it('forwards forgot-password payload', async () => {
    authService.forgotPassword.mockResolvedValueOnce({
      message: 'If the email exists, password reset OTP has been sent',
    });

    await expect(
      controller.forgotPassword(
        { headers: { origin: 'http://localhost:3000' } } as any,
        { identifier: 'owner@test.com', channel: 'EMAIL' },
      ),
    ).resolves.toEqual({
      message: 'If the email exists, password reset OTP has been sent',
    });

    expect(authService.forgotPassword).toHaveBeenCalledWith(
      'owner@test.com',
      'EMAIL',
    );
  });

  it('forwards password reset completion payload', async () => {
    await expect(
      controller.resetPassword(
        { headers: { origin: 'http://localhost:3000' } } as any,
        {
          identifier: 'owner@test.com',
          otp: '123456',
          newPassword: 'NewPassword1!',
        },
      ),
    ).resolves.toEqual({ message: 'Password reset successfully' });

    expect(authService.resetPassword).toHaveBeenCalledWith(
      'owner@test.com',
      '123456',
      'NewPassword1!',
    );
  });

  it('forwards contact verification confirmation', async () => {
    authService.verifyContactOtp.mockResolvedValueOnce({
      message: 'Contact verified successfully',
      channel: 'EMAIL',
    });

    await expect(
      controller.confirmContactVerification(
        { headers: { origin: 'http://localhost:3000' } } as any,
        'user-1',
        { requestId: 'verify-1', otp: '123456' },
      ),
    ).resolves.toEqual({
      message: 'Contact verified successfully',
      channel: 'EMAIL',
    });

    expect(authService.verifyContactOtp).toHaveBeenCalledWith(
      'user-1',
      'verify-1',
      '123456',
    );
  });
});
