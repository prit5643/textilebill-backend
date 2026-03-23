import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';
import { Queue, Worker } from 'bullmq';

type OtpDeliveryChannel = 'EMAIL';
type OtpPurpose = 'LOGIN' | 'VERIFY_EMAIL' | 'PASSWORD_RESET';
type MailTransport = 'smtp' | 'gmail';

export type DeliverOtpInput = {
  channel: OtpDeliveryChannel;
  target: string;
  otp: string;
  purpose: OtpPurpose;
  maskedTarget: string;
};

type MailConfig = {
  enabled?: boolean;
  transport?: MailTransport;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
  gmailUser?: string;
  gmailAppPassword?: string;
  gmailFrom?: string;
  sendTimeoutMs?: number;
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
};

type RedisConfig = {
  host?: string;
  port?: number;
  password?: string;
};

type EmailQueueJob = {
  type: 'INVITE' | 'PASSWORD_RESET_LINK';
  to: string;
  link: string;
  expiryMinutes: number;
};

@Injectable()
export class OtpDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger(OtpDeliveryService.name);
  private mailTransporter: Transporter | null = null;
  private emailQueue: Queue<EmailQueueJob> | null = null;
  private emailDlqQueue: Queue<EmailQueueJob> | null = null;
  private emailWorker: Worker<EmailQueueJob> | null = null;
  private queueReady = false;
  private queueInitPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.emailWorker?.close(),
      this.emailQueue?.close(),
      this.emailDlqQueue?.close(),
    ]);
  }

  async deliver(input: DeliverOtpInput): Promise<boolean> {
    return this.sendEmailOtp(input);
  }

  async sendInviteEmail(
    to: string,
    inviteLink: string,
    expiryMinutes = 30,
  ): Promise<boolean> {
    if (this.isAsyncEmailQueueEnabled()) {
      return this.enqueueEmailJob({
        type: 'INVITE',
        to,
        link: inviteLink,
        expiryMinutes,
      });
    }

    return this.sendInviteEmailNow(to, inviteLink, expiryMinutes);
  }

  async sendPasswordResetLinkEmail(
    to: string,
    resetLink: string,
    expiryMinutes = 30,
  ): Promise<boolean> {
    if (this.isAsyncEmailQueueEnabled()) {
      return this.enqueueEmailJob({
        type: 'PASSWORD_RESET_LINK',
        to,
        link: resetLink,
        expiryMinutes,
      });
    }

    return this.sendPasswordResetLinkEmailNow(to, resetLink, expiryMinutes);
  }

  private async sendInviteEmailNow(
    to: string,
    inviteLink: string,
    expiryMinutes = 30,
  ): Promise<boolean> {
    const config = this.configService.get<MailConfig>('mail') ?? {};
    if (!config.enabled) {
      this.logger.log(
        `[INVITE] delivery fallback -> target=${to.replace(/(.{2}).+(@.+)/, '$1***$2')}, link=${inviteLink}`,
      );
      return true;
    }

    const subject = 'You have been invited to TextileBill';
    const text = `You have been invited to join TextileBill. Set your password here: ${inviteLink}\n\nThis link expires in ${expiryMinutes} minutes.`;
    const html = this.buildInviteEmailHtml(inviteLink, expiryMinutes);

    const validationError = this.getMailConfigValidationError(config, 'invite email');
    if (validationError) {
      this.logger.error(validationError);
      return false;
    }
    const from = this.getMailFromAddress(config) as string;

    try {
      const transporter = this.getMailTransporter(config);
      await this.sendMailWithTimeout(
        transporter,
        {
          from,
          to,
          subject,
          text,
          html,
        },
        this.getMailTimeoutMs(config),
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${to}: ${this.toErrorMessage(error)}`);
      return false;
    }
  }

  private async sendPasswordResetLinkEmailNow(
    to: string,
    resetLink: string,
    expiryMinutes = 30,
  ): Promise<boolean> {
    const config = this.configService.get<MailConfig>('mail') ?? {};
    if (!config.enabled) {
      this.logger.log(
        `[PASSWORD_RESET_LINK] delivery fallback -> target=${to.replace(/(.{2}).+(@.+)/, '$1***$2')}, link=${resetLink}`,
      );
      return true;
    }

    const subject = 'Reset your TextileBill password';
    const text = `Reset your TextileBill password using this secure link: ${resetLink}\n\nThis link expires in ${expiryMinutes} minutes.`;
    const html = this.buildPasswordResetLinkEmailHtml(resetLink, expiryMinutes);

    const validationError = this.getMailConfigValidationError(
      config,
      'password reset link',
    );
    if (validationError) {
      this.logger.error(validationError);
      return false;
    }
    const from = this.getMailFromAddress(config) as string;

    try {
      const transporter = this.getMailTransporter(config);
      await this.sendMailWithTimeout(
        transporter,
        {
          from,
          to,
          subject,
          text,
          html,
        },
        this.getMailTimeoutMs(config),
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send password reset link email to ${to}: ${this.toErrorMessage(error)}`,
      );
      return false;
    }
  }

  private isAsyncEmailQueueEnabled(): boolean {
    const value = this.configService.get<boolean | string | undefined>(
      'mail.asyncQueueEnabled',
    );

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return process.env.NODE_ENV !== 'test';
  }

  private getRedisConnection() {
    const redis = this.configService.get<RedisConfig>('redis') ?? {};
    if (!redis.host || !redis.port) {
      return null;
    }

    return {
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: null,
    };
  }

  private async ensureQueueReady(): Promise<void> {
    if (this.queueReady) {
      return;
    }

    if (this.queueInitPromise) {
      await this.queueInitPromise;
      return;
    }

    this.queueInitPromise = (async () => {
      const connection = this.getRedisConnection();
      if (!connection) {
        throw new Error('Redis configuration is unavailable for email queue');
      }

      this.emailQueue = new Queue<EmailQueueJob>('email-delivery', {
        connection,
      });
      this.emailDlqQueue = new Queue<EmailQueueJob>('email-delivery-dlq', {
        connection,
      });

      this.emailWorker = new Worker<EmailQueueJob>(
        'email-delivery',
        async (job) => {
          if (job.data.type === 'INVITE') {
            const ok = await this.sendInviteEmailNow(
              job.data.to,
              job.data.link,
              job.data.expiryMinutes,
            );
            if (!ok) {
              throw new Error('Invite email delivery failed');
            }
            return;
          }

          const ok = await this.sendPasswordResetLinkEmailNow(
            job.data.to,
            job.data.link,
            job.data.expiryMinutes,
          );
          if (!ok) {
            throw new Error('Password reset link email delivery failed');
          }
        },
        {
          connection,
          concurrency: 2,
        },
      );

      this.emailWorker.on('failed', async (job, err) => {
        if (!job) {
          return;
        }

        const attempts = job.opts.attempts ?? 1;
        if (job.attemptsMade >= attempts && this.emailDlqQueue) {
          await this.emailDlqQueue.add('email-dlq', job.data, {
            removeOnComplete: true,
            removeOnFail: false,
          });
        }

        this.logger.error(
          `Email queue job failed: id=${job.id} type=${job.data.type} target=${job.data.to} error=${this.toErrorMessage(err)}`,
        );
      });

      this.queueReady = true;
    })();

    try {
      await this.queueInitPromise;
    } finally {
      this.queueInitPromise = null;
    }
  }

  private async enqueueEmailJob(data: EmailQueueJob): Promise<boolean> {
    try {
      await this.ensureQueueReady();
      await this.emailQueue?.add(data.type.toLowerCase(), data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });

      return true;
    } catch (error) {
      this.logger.warn(
        `Email queue unavailable, falling back to direct delivery: ${this.toErrorMessage(error)}`,
      );

      if (data.type === 'INVITE') {
        return this.sendInviteEmailNow(data.to, data.link, data.expiryMinutes);
      }

      return this.sendPasswordResetLinkEmailNow(
        data.to,
        data.link,
        data.expiryMinutes,
      );
    }
  }

  private async sendEmailOtp(input: DeliverOtpInput): Promise<boolean> {
    const config = this.configService.get<MailConfig>('mail') ?? {};
    if (!config.enabled) {
      this.logStub(input);
      return true;
    }

    const validationError = this.getMailConfigValidationError(config, 'otp email');
    if (validationError) {
      this.logger.error(validationError);
      throw new Error(validationError);
    }
    const from = this.getMailFromAddress(config) as string;

    try {
      const transporter = this.getMailTransporter(config);
      this.logger.log(
        `[OTP] Sending ${input.purpose} OTP email to ${input.maskedTarget} via ${this.getMailTransportLabel(config)}...`,
      );
      const info = await this.sendMailWithTimeoutAndResponse(
        transporter,
        {
          from,
          to: input.target,
          subject: this.buildEmailSubject(input.purpose),
          text: this.buildPlaintextMessage(input.otp, input.purpose),
          html: this.buildEmailHtml(input.otp, input.purpose),
        },
        this.getMailTimeoutMs(config),
      );
      this.logger.log(
        `[OTP] Email sent successfully to ${input.maskedTarget}. MessageId: ${info?.messageId ?? 'N/A'}, Response: ${info?.response ?? 'N/A'}`,
      );

      return true;
    } catch (error) {
      const reason = this.toErrorMessage(error);
      this.logger.error(
        `Failed to send OTP email to ${input.maskedTarget}: ${reason}`,
      );
      this.logger.warn(
        `${this.getMailTransportLabel(config)} delivery failed; OTP email was not delivered.`,
      );
      throw new Error(reason);
    }
  }

  private getMailTransport(config: MailConfig): MailTransport {
    return config.transport === 'gmail' ? 'gmail' : 'smtp';
  }

  private getMailTransportLabel(config: MailConfig): 'SMTP' | 'Gmail' {
    return this.getMailTransport(config) === 'gmail' ? 'Gmail' : 'SMTP';
  }

  private getMailFromAddress(config: MailConfig): string | undefined {
    if (this.getMailTransport(config) === 'gmail') {
      return config.gmailFrom || config.from || config.gmailUser;
    }

    return config.from;
  }

  private getMailConfigValidationError(
    config: MailConfig,
    context: 'invite email' | 'password reset link' | 'otp email',
  ): string | null {
    const transport = this.getMailTransport(config);
    const from = this.getMailFromAddress(config);

    if (transport === 'gmail') {
      if (!config.gmailUser || !config.gmailAppPassword || !from) {
        return `MAIL_ENABLED is true but Gmail configuration is incomplete (${context}).`;
      }

      return null;
    }

    if (!config.host || !config.port || !config.user || !config.password || !from) {
      if (context === 'otp email') {
        return 'MAIL_ENABLED is true but SMTP configuration is incomplete.';
      }

      return `MAIL_ENABLED is true but SMTP configuration is incomplete (${context}).`;
    }

    return null;
  }

  private getMailTransporter(config: MailConfig): Transporter {
    if (!this.mailTransporter) {
      const timeoutMs = this.getMailTimeoutMs(config);
      this.logger.log(`Initializing MailTransporter. Configured timeouts: send=${timeoutMs}, connect=${config.connectionTimeoutMs}, greet=${config.greetingTimeoutMs}, socket=${config.socketTimeoutMs}`);
      
      if (this.getMailTransport(config) === 'gmail') {
        this.logger.log(`Using Gmail transport for user: ${config.gmailUser}`);
        this.mailTransporter = nodemailer.createTransport({
          service: 'gmail',
          logger: true, // Enable built-in Nodemailer logging
          debug: true,  // Include SMTP traffic in the logs
          connectionTimeout: config.connectionTimeoutMs ?? timeoutMs,
          greetingTimeout: config.greetingTimeoutMs ?? timeoutMs,
          socketTimeout: config.socketTimeoutMs ?? timeoutMs,
          auth: {
            user: config.gmailUser,
            pass: config.gmailAppPassword,
          },
        });
      } else {
        this.logger.log(`Using SMTP transport: ${config.host}:${config.port} (secure: ${!!config.secure})`);
        this.mailTransporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: !!config.secure,
          logger: true, // Enable built-in Nodemailer logging
          debug: true,  // Include SMTP traffic in the logs
          connectionTimeout: config.connectionTimeoutMs ?? timeoutMs,
          greetingTimeout: config.greetingTimeoutMs ?? timeoutMs,
          socketTimeout: config.socketTimeoutMs ?? timeoutMs,
          auth: {
            user: config.user,
            pass: config.password,
          },
        });
      }
    }

    return this.mailTransporter;
  }

  private getMailTimeoutMs(config: MailConfig): number {
    const value = config.sendTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    return 10000;
  }

  private async sendMailWithTimeout(
    transporter: Transporter,
    payload: SendMailOptions,
    timeoutMs: number,
  ) {
    this.logger.log(`Starting to send email to ${payload.to} with a node-level timeout of ${timeoutMs}ms...`);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.logger.error(`Node-level Promise timeout triggered after ${timeoutMs}ms while sending to ${payload.to}`);
        reject(new Error(`Mail send timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([transporter.sendMail(payload), timeoutPromise]);
      this.logger.log(`Nodemailer completed sendMail successfully to ${payload.to}`);
      return result;
    } catch (error) {
      this.logger.error(`sendMailWithTimeout caught an error during transport: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async sendMailWithTimeoutAndResponse(
    transporter: Transporter,
    payload: SendMailOptions,
    timeoutMs: number,
  ): Promise<{ messageId?: string; response?: string } | null> {
    this.logger.log(`Starting to send email to ${payload.to} with a node-level timeout of ${timeoutMs}ms...`);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.logger.error(`Node-level Promise timeout triggered after ${timeoutMs}ms while sending to ${payload.to}`);
        reject(new Error(`Mail send timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        transporter.sendMail(payload),
        timeoutPromise,
      ]);
      this.logger.log(`Nodemailer completed sendMail successfully to ${payload.to}. MessageId: ${(result as any)?.messageId}`);
      return result as { messageId?: string; response?: string };
    } catch (error) {
      this.logger.error(`sendMailWithTimeoutAndResponse caught an error during transport: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private buildEmailSubject(purpose: OtpPurpose): string {
    return `TextileBill ${this.describePurpose(purpose)} OTP`;
  }

  private buildPlaintextMessage(otp: string, purpose: OtpPurpose): string {
    return `Your TextileBill OTP for ${this.describePurpose(purpose).toLowerCase()} is ${otp}. It expires in 10 minutes.`;
  }

  private buildEmailHtml(otp: string, purpose: OtpPurpose): string {
    const purposeText = this.describePurpose(purpose);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your OTP Code - Textile Bill</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background-color: #F5F1EB;
      font-family: 'DM Sans', Arial, sans-serif;
      color: #2C2A26;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      max-width: 600px;
      margin: 40px auto;
      background: #FFFFFF;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #E4DFDA;
    }

    .header {
      background-color: #1A1208;
      padding: 32px 48px;
      text-align: center;
    }

    .brand-logo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }

    .brand-icon {
      width: 36px;
      height: 36px;
    }

    .brand-name {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 22px;
      color: #F5F1EB;
      letter-spacing: 0.04em;
    }

    .body {
      padding: 48px 48px 32px;
    }

    .eyebrow {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #A3845A;
      margin-bottom: 12px;
    }

    .headline {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 28px;
      color: #1A1208;
      line-height: 1.3;
      margin-bottom: 16px;
    }

    .subtext {
      font-size: 15px;
      color: #6B6560;
      line-height: 1.7;
      margin-bottom: 36px;
    }

    .otp-container {
      background: #F5F1EB;
      border: 1.5px dashed #C8B99A;
      border-radius: 10px;
      padding: 28px 24px;
      text-align: center;
      margin-bottom: 36px;
    }

    .otp-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #A3845A;
      margin-bottom: 14px;
    }

    .otp-code {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 48px;
      letter-spacing: 0.18em;
      color: #1A1208;
      line-height: 1;
      margin-bottom: 14px;
    }

    .otp-timer {
      font-size: 13px;
      color: #A3845A;
    }

    .otp-timer strong {
      color: #C0722A;
      font-weight: 600;
    }

    .divider {
      border: none;
      border-top: 1px solid #E4DFDA;
      margin: 32px 0;
    }

    .note {
      background: #FEF6EC;
      border-left: 3px solid #C0722A;
      border-radius: 0 6px 6px 0;
      padding: 14px 16px;
      font-size: 13px;
      color: #6B4A24;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .note strong {
      font-weight: 600;
      color: #4A2E0E;
    }

    .help-text {
      font-size: 14px;
      color: #6B6560;
      line-height: 1.7;
      margin-bottom: 12px;
    }

    .help-text a {
      color: #A3845A;
      text-decoration: none;
      font-weight: 500;
    }

    .footer {
      background: #F5F1EB;
      padding: 24px 48px;
      border-top: 1px solid #E4DFDA;
      text-align: center;
    }

    .footer-brand {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 14px;
      color: #A3845A;
      margin-bottom: 8px;
    }

    .footer-addr {
      font-size: 12px;
      color: #A39D97;
      line-height: 1.6;
      margin-bottom: 12px;
    }

    .footer-links {
      font-size: 12px;
    }

    .footer-links a {
      color: #A3845A;
      text-decoration: none;
      margin: 0 8px;
    }

    .footer-links a:hover {
      text-decoration: underline;
    }

    .separator {
      color: #C8B99A;
    }

    @media (max-width: 600px) {
      .wrapper { margin: 0; border-radius: 0; }
      .header { padding: 24px 24px; }
      .body { padding: 32px 24px 24px; }
      .footer { padding: 20px 24px; }
      .otp-code { font-size: 36px; letter-spacing: 0.14em; }
      .headline { font-size: 22px; }
    }
  </style>
</head>
<body>

<div class="wrapper">
  <div class="header">
    <div class="brand-logo">
      <svg class="brand-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="8" fill="#A3845A"/>
        <path d="M8 10 L28 10 L28 14 L20 14 L20 26 L16 26 L16 14 L8 14 Z" fill="#1A1208"/>
        <path d="M10 18 L26 18" stroke="#F5F1EB" stroke-width="1.5" stroke-dasharray="2 2"/>
      </svg>
      <span class="brand-name">Textile Bill</span>
    </div>
  </div>

  <div class="body">
    <p class="eyebrow">Verification Required</p>
    <h1 class="headline">Your one-time<br/>passcode is here</h1>
    <p class="subtext">
      Use the code below to verify your identity and continue with ${purposeText.toLowerCase()}. It is valid for a limited time only.
    </p>

    <div class="otp-container">
      <p class="otp-label">One-Time Password</p>
      <div class="otp-code">${otp}</div>
      <p class="otp-timer">Expires in <strong>10 minutes</strong></p>
    </div>

    <div class="note">
      <strong>Do not share this code.</strong> Textile Bill will never ask for your OTP via phone, chat, or email. If you did not request this, please ignore this message or contact our support.
    </div>

    <hr class="divider"/>

    <p class="help-text">
      Having trouble? Reach us at <a href="mailto:support@textilebill.com">support@textilebill.com</a>.
    </p>
  </div>

  <div class="footer">
    <p class="footer-brand">Textile Bill</p>
    <p class="footer-addr">
      123 Fabric Lane, Surat, Gujarat 395001, India<br/>
      This is an automated email.
    </p>
    <p class="footer-links">
      <a href="https://textilebill.com/privacy">Privacy Policy</a>
      <span class="separator">·</span>
      <a href="mailto:support@textilebill.com">Support</a>
    </p>
  </div>
</div>

</body>
</html>
    `;
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

  private logStub(input: DeliverOtpInput) {
    this.logger.log(
      `[OTP:${input.purpose}] delivery fallback -> channel=${input.channel}, target=${input.maskedTarget}, otp=${input.otp}`,
    );
  }

  private buildInviteEmailHtml(inviteLink: string, expiryMinutes: number): string {
    return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 480px; margin: auto;">
        <h2 style="color: #1d4ed8;">You have been invited to TextileBill</h2>
        <p>An admin has created an account for you. Click the button below to set your password and get started.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteLink}"
             style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
            Set My Password
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">This link expires in <strong>${expiryMinutes} minutes</strong>. If you did not expect this invitation, you can safely ignore this email.</p>
        <p style="color:#6b7280;font-size:12px;">Or paste this URL in your browser:<br>${inviteLink}</p>
      </div>
    `;
  }

  private buildPasswordResetLinkEmailHtml(
    resetLink: string,
    expiryMinutes: number,
  ): string {
    const currentYear = new Date().getFullYear();
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Header with Logo -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 40px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="width: 56px; height: 56px; background-color: rgba(255,255,255,0.2); border-radius: 12px; display: inline-block; line-height: 56px; margin-bottom: 12px;">
                      <span style="font-size: 28px; color: #ffffff;">🔐</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">TextileBill</h1>
                    <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.8); font-size: 13px;">Secure Password Reset</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 20px; font-weight: 600;">Reset Your Password</h2>
              <p style="margin: 0 0 24px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                We received a request to reset the password for your TextileBill account. Click the button below to create a new password.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 24px 0;">
                    <a href="${resetLink}" 
                       style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Timer Warning -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 6px;">
                    <p style="margin: 0; color: #92400e; font-size: 13px;">
                      ⏱️ This link expires in <strong>${expiryMinutes} minutes</strong> for security reasons.
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 24px;">
                <tr>
                  <td style="background-color: #f0f9ff; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0 0 8px 0; color: #1e40af; font-size: 13px; font-weight: 600;">🛡️ Security Tips</p>
                    <ul style="margin: 0; padding-left: 18px; color: #4b5563; font-size: 12px; line-height: 1.6;">
                      <li>Never share this link with anyone</li>
                      <li>Choose a strong, unique password</li>
                      <li>If you didn't request this, ignore this email</li>
                    </ul>
                  </td>
                </tr>
              </table>
              
              <!-- Alternative Link -->
              <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.5;">
                <strong>Button not working?</strong> Copy and paste this link into your browser:<br>
                <a href="${resetLink}" style="color: #3b82f6; word-break: break-all;">${resetLink}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px;">
                      This is an automated message from TextileBill
                    </p>
                    <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                      © ${currentYear} TextileBill. All rights reserved.<br>
                      Your trusted textile billing solution.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
        
        <!-- Bottom Note -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; margin-top: 20px;">
          <tr>
            <td align="center">
              <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                Questions? Contact us at <a href="mailto:support@textilebill.com" style="color: #6b7280;">support@textilebill.com</a>
              </p>
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      const candidate = error as {
        message?: unknown;
        code?: unknown;
        response?: { status?: unknown; data?: unknown };
      };

      const message =
        typeof candidate.message === 'string' && candidate.message.trim().length > 0
          ? candidate.message.trim()
          : undefined;
      const code =
        typeof candidate.code === 'string' && candidate.code.trim().length > 0
          ? candidate.code.trim()
          : undefined;
      const status =
        typeof candidate.response?.status === 'number'
          ? candidate.response.status
          : undefined;
      const data = candidate.response?.data;
      const responseDetail =
        typeof data === 'string'
          ? data
          : data !== undefined
            ? JSON.stringify(data)
            : undefined;

      const baseMessage = message ?? (code ? `Error ${code}` : 'Delivery request failed');
      if (status && responseDetail) {
        return `${baseMessage} (status ${status}: ${responseDetail})`;
      }

      if (status) {
        return `${baseMessage} (status ${status})`;
      }

      return baseMessage;
    }

    return 'Unknown delivery error';
  }
}
