import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { SessionClientMetadata } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  OtpRequestDto,
  OtpResendDto,
  OtpVerifyDto,
  ResetPasswordDto,
  VerifyContactRequestDto,
  AcceptInviteDto,
  PasswordSetupResendDto,
  PasswordResetLinkRequestDto,
  PasswordResetLinkCompleteDto,
} from './dto';
import { JwtAuthGuard, SubscriptionGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  assertAllowedOrigin,
  clearAuthCookies,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from './auth-cookie.util';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // Lightweight auth-check endpoint — the JwtAuthGuard runs the
  // JwtStrategy.validate() which checks user.isActive & tenant.isActive,
  // so polling this endpoint is enough to detect deactivation.
  @Get('me')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current authenticated user info' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getCurrentSession(userId);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username/email and password' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    assertAllowedOrigin(req, this.configService);

    const metadata = this.getSessionClientMetadata(req);
    const { accessToken, sessionToken, refreshToken, ...session } =
      await this.authService.login(dto, metadata);

    if (session?.user?.id) {
      res.locals = res.locals || {};
      res.locals.auditUserId = session.user.id;
    }

    setAuthCookies(res, this.configService, {
      accessToken,
      sessionToken,
      refreshToken,
    });

    return session;
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request OTP for login' })
  async requestOtp(@Req() req: Request, @Body() dto: OtpRequestDto) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.requestLoginOtp(
      dto.identifier,
      dto.channel ?? 'EMAIL',
    );
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and login' })
  async verifyOtp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: OtpVerifyDto,
  ) {
    assertAllowedOrigin(req, this.configService);

    const { accessToken, sessionToken, refreshToken, ...session } =
      await this.authService.verifyLoginOtp(dto.requestId, dto.otp);

    if (session?.user?.id) {
      res.locals = res.locals || {};
      res.locals.auditUserId = session.user.id;
    }

    setAuthCookies(res, this.configService, {
      accessToken,
      sessionToken,
      refreshToken,
    });

    return session;
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP for an active request' })
  async resendOtp(@Req() req: Request, @Body() dto: OtpResendDto) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.resendOtp(dto.requestId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: Partial<RefreshTokenDto>,
  ) {
    assertAllowedOrigin(req, this.configService);

    const refreshToken = getRefreshTokenFromRequest(req) || dto?.refreshToken;
    if (!refreshToken) {
      clearAuthCookies(res, this.configService);
      throw new UnauthorizedException('Refresh token is required');
    }

    try {
      const {
        accessToken,
        sessionToken,
        refreshToken: nextRefreshToken,
      } = await this.authService.refreshTokens(
        refreshToken,
        this.getSessionClientMetadata(req),
      );

      setAuthCookies(res, this.configService, {
        accessToken,
        sessionToken,
        refreshToken: nextRefreshToken,
      });

      return { refreshed: true };
    } catch (error) {
      clearAuthCookies(res, this.configService);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: Partial<RefreshTokenDto>,
  ) {
    assertAllowedOrigin(req, this.configService);

    const refreshToken = getRefreshTokenFromRequest(req) || dto?.refreshToken;

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    clearAuthCookies(res, this.configService);
    return { message: 'Logged out successfully' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change current user password' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ChangePasswordDto,
  ) {
    assertAllowedOrigin(req, this.configService);

    await this.authService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    clearAuthCookies(res, this.configService);
    return { message: 'Password changed successfully. Please sign in again.' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP via email' })
  async forgotPassword(@Req() req: Request, @Body() dto: ForgotPasswordDto) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.forgotPassword(dto.identifier, dto.channel);
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset link via email' })
  async requestPasswordResetLink(
    @Req() req: Request,
    @Body() dto: PasswordResetLinkRequestDto,
  ) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.requestPasswordResetLink(dto.identifier);
  }

  @Get('password-reset/validate')
  @ApiOperation({ summary: 'Validate password reset link token' })
  async validatePasswordResetToken(@Query('token') token: string) {
    if (!token) {
      return { valid: false };
    }
    return this.authService.validatePasswordResetToken(token);
  }

  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using secure link token' })
  async completePasswordReset(
    @Req() req: Request,
    @Body() dto: PasswordResetLinkCompleteDto,
  ) {
    assertAllowedOrigin(req, this.configService);
    await this.authService.resetPasswordWithLink(dto.token, dto.newPassword);
    return { message: 'Password reset successfully' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with OTP' })
  async resetPassword(@Req() req: Request, @Body() dto: ResetPasswordDto) {
    assertAllowedOrigin(req, this.configService);
    await this.authService.resetPassword(
      dto.identifier,
      dto.otp,
      dto.newPassword,
    );
    return { message: 'Password reset successfully' };
  }

  @Get('verification-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user contact verification status' })
  async getVerificationStatus(@CurrentUser('id') userId: string) {
    return this.authService.getVerificationStatus(userId);
  }

  @Post('verify-contact/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Request OTP to verify a contact channel' })
  async requestContactVerification(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyContactRequestDto,
  ) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.requestContactVerification(userId, dto.channel);
  }

  @Post('verify-contact/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Confirm contact verification OTP' })
  async confirmContactVerification(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Body() dto: OtpVerifyDto,
  ) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.verifyContactOtp(userId, dto.requestId, dto.otp);
  }

  @Get('invite/validate')
  @ApiOperation({
    summary: 'Validate an invite token before showing the set-password form',
  })
  async validateInvite(@Query('token') token: string) {
    if (!token) {
      return { valid: false };
    }
    return this.authService.validateInviteToken(token);
  }

  @Get('password-setup/validate')
  @ApiOperation({
    summary:
      'Validate a password setup token before showing the set-password form',
  })
  async validatePasswordSetup(@Query('token') token: string) {
    if (!token) {
      return { valid: false };
    }
    return this.authService.validatePasswordSetupToken(token);
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invite: set password and log in' })
  async acceptInvite(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AcceptInviteDto,
  ) {
    assertAllowedOrigin(req, this.configService);

    const { accessToken, sessionToken, refreshToken, ...session } =
      await this.authService.acceptInvite(dto.token, dto.newPassword);

    setAuthCookies(res as any, this.configService, {
      accessToken,
      sessionToken,
      refreshToken,
    });

    return session;
  }

  @Post('password-setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set password from setup link and log in' })
  async completePasswordSetup(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AcceptInviteDto,
  ) {
    assertAllowedOrigin(req, this.configService);

    const { accessToken, sessionToken, refreshToken, ...session } =
      await this.authService.acceptInvite(dto.token, dto.newPassword);

    setAuthCookies(res as any, this.configService, {
      accessToken,
      sessionToken,
      refreshToken,
    });

    return session;
  }

  @Post('password-setup/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend password setup link (customer self-service)',
  })
  async resendPasswordSetupLink(
    @Req() req: Request,
    @Body() dto: PasswordSetupResendDto,
  ) {
    assertAllowedOrigin(req, this.configService);
    return this.authService.resendPasswordSetupLink({
      email: dto.email,
      token: dto.token,
    });
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List current user active sessions' })
  async getSessions(@CurrentUser('id') userId: string) {
    return this.authService.getUserSessions(userId);
  }

  @Delete('sessions/:tokenId')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('tokenId') tokenId: string,
  ) {
    await this.authService.revokeSession(userId, tokenId);
    return { message: 'Session revoked' };
  }

  private getSessionClientMetadata(req: Request): SessionClientMetadata {
    const deviceHeader = req.headers['x-device-id'];
    const deviceId = Array.isArray(deviceHeader)
      ? deviceHeader[0]
      : deviceHeader;

    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor;
    const ipAddress = forwardedIp?.split(',')[0]?.trim() || req.ip || null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgentFromHeader = Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader;
    const userAgent =
      typeof req.get === 'function'
        ? (req.get('user-agent') ?? userAgentFromHeader ?? null)
        : (userAgentFromHeader ?? null);

    return {
      deviceId: deviceId ?? null,
      userAgent,
      ipAddress,
    };
  }
}
