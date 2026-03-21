import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<
      AuthService,
      | 'getCurrentSession'
      | 'login'
      | 'requestLoginOtp'
      | 'verifyLoginOtp'
      | 'acceptInvite'
      | 'resendOtp'
      | 'refreshTokens'
      | 'logout'
      | 'changePassword'
      | 'forgotPassword'
      | 'resetPassword'
      | 'getVerificationStatus'
      | 'requestContactVerification'
      | 'verifyContactOtp'
      | 'getUserSessions'
      | 'revokeSession'
    >
  >;

  const configService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      switch (key) {
        case 'app.corsOrigin':
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
      getUserSessions: jest.fn(),
      revokeSession: jest.fn(),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      configService,
    );
  });

  it('returns the full authenticated browser session on getMe', async () => {
    authService.getCurrentSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        firstName: 'Owner',
        lastName: 'User',
        tenantId: 'tenant-1',
        avatarUrl: null,
        mustChangePassword: false,
        emailVerified: true,
        phoneVerified: false,
        hasVerifiedContact: true,
      },
      companies: [],
    });

    await expect(controller.getMe('user-1')).resolves.toEqual({
      user: expect.objectContaining({ id: 'user-1' }),
      companies: [],
    });
    expect(authService.getCurrentSession).toHaveBeenCalledWith('user-1');
  });

  it('sets auth cookies on login and strips tokens from the response body', async () => {
    const response = createResponse();
    authService.login.mockResolvedValueOnce({
      accessToken: 'access-token',
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        firstName: 'Owner',
        lastName: 'User',
        tenantId: 'tenant-1',
        avatarUrl: null,
        mustChangePassword: false,
        emailVerified: true,
        phoneVerified: false,
        hasVerifiedContact: true,
      },
      companies: [{ id: 'company-1', name: 'Alpha' } as any],
    });

    const result = await controller.login(
      { headers: { origin: 'http://localhost:3000' } } as any,
      response,
      {
        username: 'owner@test.com',
        password: 'Password1!',
      },
    );

    expect(authService.login).toHaveBeenCalledWith({
      username: 'owner@test.com',
      password: 'Password1!',
    },
    expect.objectContaining({
      deviceId: null,
      userAgent: null,
      ipAddress: null,
    }));
    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      user: expect.objectContaining({ id: 'user-1' }),
      companies: [{ id: 'company-1', name: 'Alpha' }],
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('forwards OTP request payloads after origin checks', async () => {
    authService.requestLoginOtp.mockResolvedValueOnce({
      message: 'OTP sent successfully.',
      requestId: 'otp-request-1',
      channel: 'EMAIL',
      targetHint: 'ow***@test.com',
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    } as any);

    await expect(
      controller.requestOtp(
        { headers: { origin: 'http://localhost:3000' } } as any,
        { identifier: 'owner@test.com', channel: 'EMAIL' },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ requestId: 'otp-request-1' }),
    );

    expect(authService.requestLoginOtp).toHaveBeenCalledWith(
      'owner@test.com',
      'EMAIL',
    );
  });

  it('sets auth cookies when OTP verification succeeds', async () => {
    const response = createResponse();
    authService.verifyLoginOtp.mockResolvedValueOnce({
      accessToken: 'access-token',
      sessionToken: 'session-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        email: 'owner@test.com',
        username: 'owner',
        role: 'TENANT_ADMIN',
        firstName: 'Owner',
        lastName: 'User',
        tenantId: 'tenant-1',
        avatarUrl: null,
        mustChangePassword: false,
        emailVerified: true,
        phoneVerified: false,
        hasVerifiedContact: true,
      },
      companies: [],
    });

    const result = await controller.verifyOtp(
      { headers: { origin: 'http://localhost:3000' } } as any,
      response,
      { requestId: 'otp-request-1', otp: '123456' },
    );

    expect(authService.verifyLoginOtp).toHaveBeenCalledWith(
      'otp-request-1',
      '123456',
    );
    expect(response.cookie).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      user: expect.objectContaining({ id: 'user-1' }),
      companies: [],
    });
  });

  it('rejects invite acceptance from an untrusted origin before mutating cookies', async () => {
    const response = createResponse();

    await expect(
      controller.acceptInvite(
        { headers: { origin: 'http://malicious.example' } } as any,
        response,
        { token: 'invite-token', newPassword: 'NewPassword1!' },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(authService.acceptInvite).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('forwards resend requests for active OTP challenges', async () => {
    authService.resendOtp.mockResolvedValueOnce({
      message: 'OTP resent successfully.',
      requestId: 'otp-request-1',
      channel: 'EMAIL',
      targetHint: 'ow***@test.com',
      resendCooldownSeconds: 30,
      resendCount: 1,
    } as any);

    await expect(
      controller.resendOtp(
        { headers: { origin: 'http://localhost:3000' } } as any,
        { requestId: 'otp-request-1' },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ resendCount: 1, requestId: 'otp-request-1' }),
    );

    expect(authService.resendOtp).toHaveBeenCalledWith('otp-request-1');
  });

  it('refreshes from the HttpOnly cookie and rotates all session cookies', async () => {
    const response = createResponse();
    authService.refreshTokens.mockResolvedValueOnce({
      accessToken: 'next-access-token',
      sessionToken: 'next-session-token',
      refreshToken: 'next-refresh-token',
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
      expect.objectContaining({
        deviceId: null,
        userAgent: null,
        ipAddress: null,
      }),
    );
    expect(response.cookie).toHaveBeenCalledTimes(3);
  });

  it('clears all auth cookies during logout even when using the cookie transport', async () => {
    const response = createResponse();

    await expect(
      controller.logout(
        {
          headers: {
            origin: 'http://localhost:3000',
            cookie: 'tb_refresh=rt-1',
          },
        } as any,
        response,
      ),
    ).resolves.toEqual({ message: 'Logged out successfully' });

    expect(authService.logout).toHaveBeenCalledWith('rt-1');
    expect(response.clearCookie).toHaveBeenCalledTimes(3);
  });

  it('clears session cookies after a password change', async () => {
    const response = createResponse();

    await expect(
      controller.changePassword(
        'user-123',
        { headers: { origin: 'http://localhost:3000' } } as any,
        response,
        {
          currentPassword: 'old-pass',
          newPassword: 'new-pass',
        },
      ),
    ).resolves.toEqual({
      message: 'Password changed successfully. Please sign in again.',
    });

    expect(authService.changePassword).toHaveBeenCalledWith(
      'user-123',
      'old-pass',
      'new-pass',
    );
    expect(response.clearCookie).toHaveBeenCalledTimes(3);
  });

  it('forwards the authenticated user id to getSessions', async () => {
    await controller.getSessions('user-123');

    expect(authService.getUserSessions).toHaveBeenCalledWith('user-123');
  });

  it('applies origin checks to forgot-password and forwards the recovery payload', async () => {
    authService.forgotPassword.mockResolvedValueOnce({
      message: 'If the email exists, an OTP has been sent',
      resendCooldownSeconds: 32,
      resendAvailableInSeconds: 0,
    });

    await expect(
      controller.forgotPassword(
        { headers: { origin: 'http://localhost:3000' } } as any,
        { identifier: 'owner@test.com', channel: 'EMAIL' },
      ),
    ).resolves.toEqual({
      message: 'If the email exists, an OTP has been sent',
      resendCooldownSeconds: 32,
      resendAvailableInSeconds: 0,
    });

    expect(authService.forgotPassword).toHaveBeenCalledWith(
      'owner@test.com',
      'EMAIL',
    );
  });

  it('applies origin checks to reset-password and forwards the payload', async () => {
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

  it('returns the current user verification status', async () => {
    authService.getVerificationStatus.mockResolvedValueOnce({
      email: { value: 'ow***@test.com', verified: true },
      hasVerifiedContact: true,
    });

    await expect(controller.getVerificationStatus('user-1')).resolves.toEqual({
      email: { value: 'ow***@test.com', verified: true },
      hasVerifiedContact: true,
    });

    expect(authService.getVerificationStatus).toHaveBeenCalledWith('user-1');
  });

  it('requests contact verification for the authenticated user', async () => {
    authService.requestContactVerification.mockResolvedValueOnce({
      message: 'Verification OTP sent successfully.',
      requestId: 'verify-1',
      channel: 'EMAIL',
      targetHint: 'ow***@test.com',
      expiresInSeconds: 300,
      resendCooldownSeconds: 30,
    } as any);

    await expect(
      controller.requestContactVerification(
        { headers: { origin: 'http://localhost:3000' } } as any,
        'user-1',
        { channel: 'EMAIL' },
      ),
    ).resolves.toEqual(expect.objectContaining({ requestId: 'verify-1' }));

    expect(authService.requestContactVerification).toHaveBeenCalledWith(
      'user-1',
      'EMAIL',
    );
  });

  it('confirms contact verification for the authenticated user', async () => {
    authService.verifyContactOtp.mockResolvedValueOnce({
      message: 'Contact verified successfully',
    });

    await expect(
      controller.confirmContactVerification(
        { headers: { origin: 'http://localhost:3000' } } as any,
        'user-1',
        { requestId: 'verify-1', otp: '123456' },
      ),
    ).resolves.toEqual({ message: 'Contact verified successfully' });

    expect(authService.verifyContactOtp).toHaveBeenCalledWith(
      'user-1',
      'verify-1',
      '123456',
    );
  });

  it('forwards the authenticated user id to revokeSession', async () => {
    await controller.revokeSession('user-123', 'session-1');

    expect(authService.revokeSession).toHaveBeenCalledWith(
      'user-123',
      'session-1',
    );
  });
});
