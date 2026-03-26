import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

type OtpDeliveryChannel = 'EMAIL';
type OtpPurpose = 'LOGIN' | 'VERIFY_EMAIL' | 'PASSWORD_RESET';

export type DeliverOtpInput = {
  channel: OtpDeliveryChannel;
  target: string;
  otp: string;
  purpose: OtpPurpose;
  maskedTarget: string;
};

type MailConfig = {
  enabled?: boolean;
  from?: string;
  resendApiKey?: string;
  resendFrom?: string;
  resendReplyTo?: string;
};

@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);
  private resendClient: Resend | null = null;

  constructor(private readonly configService: ConfigService) {
    this.logger.log('[MAIL_IMPL] resend-only otp-delivery v2026-03-23');
  }

  async deliver(input: DeliverOtpInput): Promise<boolean> {
    const config = this.getMailConfig();

    this.logger.log(
      `[OTP_MAIL_DEBUG] ${JSON.stringify({
        purpose: input.purpose,
        channel: input.channel,
        target: input.maskedTarget,
        ...this.getMailRuntimeSnapshot(config),
      })}`,
    );

    // If mail is disabled, log to console (dev mode)
    if (!config.enabled) {
      this.logger.log(
        `[OTP:${input.purpose}] Dev mode -> channel=${input.channel}, target=${input.maskedTarget}, otp=${input.otp}`,
      );
      return true;
    }

    // Validate config
    const validationError = this.validateConfig(config);
    if (validationError) {
      this.logger.error(validationError);
      throw new Error(validationError);
    }

    try {
      const client = this.getResendClient(config);
      const from = config.resendFrom || config.from;

      this.logger.log(`[OTP] Sending ${input.purpose} email to ${input.maskedTarget}...`);

      const result = await client.emails.send({
        from: from!,
        to: input.target,
        subject: this.buildSubject(input.purpose),
        text: this.buildPlainText(input.otp, input.purpose),
        html: this.buildHtml(input.otp, input.purpose),
        replyTo: config.resendReplyTo,
      });

      if (result.error) {
        this.logger.error(`[OTP] Resend API error: ${result.error.message}`);
        throw new Error(`Resend API error: ${result.error.message}`);
      }

      this.logger.log(`[OTP] Email sent successfully to ${input.maskedTarget}. ID: ${result.data?.id}`);
      this.logger.log(
        `[OTP_MAIL_RESULT] ${JSON.stringify({
          status: 'accepted_by_provider',
          provider: 'resend',
          purpose: input.purpose,
          channel: input.channel,
          target: input.maskedTarget,
          messageId: result.data?.id ?? null,
        })}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[OTP] Failed to send email: ${message}`);
      this.logger.error(
        `[OTP_MAIL_ERROR] ${JSON.stringify({
          status: 'failed',
          provider: 'resend',
          purpose: input.purpose,
          channel: input.channel,
          target: input.maskedTarget,
          error: message,
        })}`,
      );
      throw error;
    }
  }

  async sendInviteEmail(to: string, inviteLink: string, expiryMinutes = 30): Promise<boolean> {
    const config = this.getMailConfig();

    if (!config.enabled) {
      this.logger.log(`[INVITE] Dev mode -> target=${this.maskEmail(to)}, link=${inviteLink}`);
      return true;
    }

    const validationError = this.validateConfig(config);
    if (validationError) {
      this.logger.error(validationError);
      return false;
    }

    try {
      const client = this.getResendClient(config);
      const from = config.resendFrom || config.from;

      const result = await client.emails.send({
        from: from!,
        to,
        subject: 'You have been invited to TextileBill',
        text: `You have been invited to join TextileBill. Set your password here: ${inviteLink}\n\nThis link expires in ${expiryMinutes} minutes.`,
        html: this.buildInviteHtml(inviteLink, expiryMinutes),
        replyTo: config.resendReplyTo,
      });

      if (result.error) {
        this.logger.error(`[INVITE] Resend API error: ${result.error.message}`);
        return false;
      }

      this.logger.log(`[INVITE] Email sent to ${this.maskEmail(to)}. ID: ${result.data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`[INVITE] Failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async sendPasswordResetLinkEmail(to: string, resetLink: string, expiryMinutes = 30): Promise<boolean> {
    const config = this.getMailConfig();

    if (!config.enabled) {
      this.logger.log(`[PASSWORD_RESET] Dev mode -> target=${this.maskEmail(to)}, link=${resetLink}`);
      return true;
    }

    const validationError = this.validateConfig(config);
    if (validationError) {
      this.logger.error(validationError);
      return false;
    }

    try {
      const client = this.getResendClient(config);
      const from = config.resendFrom || config.from;

      const result = await client.emails.send({
        from: from!,
        to,
        subject: 'Reset your TextileBill password',
        text: `Reset your TextileBill password using this secure link: ${resetLink}\n\nThis link expires in ${expiryMinutes} minutes.`,
        html: this.buildPasswordResetHtml(resetLink, expiryMinutes),
        replyTo: config.resendReplyTo,
      });

      if (result.error) {
        this.logger.error(`[PASSWORD_RESET] Resend API error: ${result.error.message}`);
        return false;
      }

      this.logger.log(`[PASSWORD_RESET] Email sent to ${this.maskEmail(to)}. ID: ${result.data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`[PASSWORD_RESET] Failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private getMailConfig(): MailConfig {
    return this.configService.get<MailConfig>('mail') ?? {};
  }

  private validateConfig(config: MailConfig): string | null {
    const apiKey = config.resendApiKey?.trim();
    const from = config.resendFrom?.trim() || config.from?.trim();
    const missing: string[] = [];

    if (!apiKey) missing.push('MAIL_RESEND_API_KEY');
    if (!from) missing.push('MAIL_RESEND_FROM or MAIL_FROM');

    if (missing.length > 0) {
      return `MAIL_ENABLED is true but Resend configuration is incomplete. Missing: ${missing.join(', ')}`;
    }

    return null;
  }

  private getResendClient(config: MailConfig): Resend {
    if (!this.resendClient) {
      this.logger.log('Initializing Resend client...');
      this.resendClient = new Resend(config.resendApiKey!);
    }
    return this.resendClient;
  }

  private getMailRuntimeSnapshot(config: MailConfig): {
    enabled: boolean;
    hasResendApiKey: boolean;
    hasFromAddress: boolean;
    hasReplyTo: boolean;
  } {
    return {
      enabled: !!config.enabled,
      hasResendApiKey: !!config.resendApiKey?.trim(),
      hasFromAddress: !!(config.resendFrom?.trim() || config.from?.trim()),
      hasReplyTo: !!config.resendReplyTo?.trim(),
    };
  }

  private maskEmail(email: string): string {
    return email.replace(/(.{2}).+(@.+)/, '$1***$2');
  }

  private buildSubject(purpose: OtpPurpose): string {
    const purposeText = this.describePurpose(purpose);
    return `TextileBill ${purposeText} OTP`;
  }

  private buildPlainText(otp: string, purpose: OtpPurpose): string {
    return `Your TextileBill OTP for ${this.describePurpose(purpose).toLowerCase()} is ${otp}. It expires in 10 minutes.`;
  }

  private describePurpose(purpose: OtpPurpose): string {
    switch (purpose) {
      case 'LOGIN':
        return 'Login';
      case 'VERIFY_EMAIL':
        return 'Email Verification';
      case 'PASSWORD_RESET':
        return 'Password Reset';
      default:
        return 'Authentication';
    }
  }

  private buildHtml(otp: string, purpose: OtpPurpose): string {
    const purposeText = this.describePurpose(purpose);
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your OTP Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: #1a1208; padding: 28px; text-align: center;">
              <h1 style="margin: 0; color: #f5f1eb; font-size: 22px; font-weight: 600;">TextileBill</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px 32px;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #a3845a; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Secure ${purposeText}</p>
              <h2 style="margin: 0 0 16px; font-size: 24px; color: #1a1208;">Your Verification Code</h2>
              <p style="margin: 0 0 28px; color: #6b6560; line-height: 1.6;">Use this one-time code to complete your ${purposeText.toLowerCase()}:</p>
              
              <!-- OTP Box -->
              <div style="background: #f5f1eb; border: 2px dashed #c8b99a; border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 28px;">
                <p style="margin: 0 0 12px; font-size: 11px; color: #a3845a; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">One-Time Password</p>
                <p style="margin: 0 0 12px; font-size: 42px; font-weight: bold; letter-spacing: 8px; color: #1a1208;">${otp}</p>
                <p style="margin: 0; font-size: 13px; color: #a3845a;">Expires in <strong style="color: #c0722a;">10 minutes</strong></p>
              </div>
              
              <!-- Warning -->
              <div style="background: #fef6ec; border-left: 3px solid #c0722a; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 13px; color: #6b4a24;"><strong>Security Notice:</strong> Never share this code with anyone. TextileBill will never ask for it.</p>
              </div>
              
              <p style="margin: 0; font-size: 14px; color: #6b6560;">If you didn't request this code, please ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background: #f5f1eb; padding: 20px; text-align: center; border-top: 1px solid #e4dfda;">
              <p style="margin: 0; font-size: 12px; color: #a3845a;">&copy; ${new Date().getFullYear()} TextileBill. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildInviteHtml(inviteLink: string, expiryMinutes: number): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: #1a1208; padding: 28px; text-align: center;">
              <h1 style="margin: 0; color: #f5f1eb; font-size: 22px; font-weight: 600;">TextileBill</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 24px; color: #1a1208;">You're Invited!</h2>
              <p style="margin: 0 0 24px; color: #6b6560; line-height: 1.6;">An admin has created an account for you. Click below to set your password and get started.</p>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <a href="${inviteLink}" style="display: inline-block; background: #1a1208; color: #f5f1eb; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Set My Password</a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 12px; font-size: 13px; color: #a3845a;">This link expires in <strong style="color: #c0722a;">${expiryMinutes} minutes</strong>.</p>
              <p style="margin: 0; font-size: 12px; color: #6b6560; word-break: break-all;">Or paste this URL: ${inviteLink}</p>
            </td>
          </tr>
          <tr>
            <td style="background: #f5f1eb; padding: 20px; text-align: center; border-top: 1px solid #e4dfda;">
              <p style="margin: 0; font-size: 12px; color: #a3845a;">&copy; ${new Date().getFullYear()} TextileBill. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPasswordResetHtml(resetLink: string, expiryMinutes: number): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: #1a1208; padding: 28px; text-align: center;">
              <h1 style="margin: 0; color: #f5f1eb; font-size: 22px; font-weight: 600;">TextileBill</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 24px; color: #1a1208;">Reset Your Password</h2>
              <p style="margin: 0 0 24px; color: #6b6560; line-height: 1.6;">We received a request to reset your password. Click the button below to create a new one.</p>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <a href="${resetLink}" style="display: inline-block; background: #1a1208; color: #f5f1eb; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Reset Password</a>
                  </td>
                </tr>
              </table>
              
              <div style="background: #fef6ec; border-left: 3px solid #c0722a; padding: 12px 16px; border-radius: 0 6px 6px 0; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 13px; color: #6b4a24;">This link expires in <strong>${expiryMinutes} minutes</strong>.</p>
              </div>
              
              <p style="margin: 0; font-size: 14px; color: #6b6560;">If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="background: #f5f1eb; padding: 20px; text-align: center; border-top: 1px solid #e4dfda;">
              <p style="margin: 0; font-size: 12px; color: #a3845a;">&copy; ${new Date().getFullYear()} TextileBill. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
