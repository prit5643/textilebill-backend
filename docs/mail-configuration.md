# Email Configuration (Resend Only)

**Last Updated:** March 24, 2026  
**Status:** Active

## Summary

OTP, invite, and password reset email delivery now uses **Resend only**.  
Legacy alternate mail transport paths are removed from active backend configuration and scripts.

## Required Environment Variables

```bash
MAIL_ENABLED=true
MAIL_FROM=TextileBill <onboarding@resend.dev>
MAIL_RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
MAIL_RESEND_FROM=TextileBill <billing@yourdomain.com>
MAIL_RESEND_REPLY_TO=support@yourdomain.com
MAIL_SEND_TIMEOUT_MS=10000
MAIL_MAX_SENDS_PER_PROCESS=5000
```

Notes:
- `MAIL_RESEND_FROM` should use a verified sender/domain in Resend.
- `MAIL_FROM` remains as a fallback sender value.
- `MAIL_RESEND_REPLY_TO` is optional.

## Quick Verification

```bash
# Validate config only
npm run test:mail:verify -- --verify-only

# Validate config and send a live test email
MAIL_TEST_TO=test@example.com npm run test:mail:verify
```

## Runtime Behavior

- If `MAIL_ENABLED=false`, OTP/invite/reset flows log delivery in development fallback mode.
- If `MAIL_ENABLED=true` with missing Resend config, delivery fails fast with clear errors.
- OTP delivery channel remains `EMAIL` at the API level; provider is Resend.

## Security

- Never commit `.env` secrets.
- Rotate `MAIL_RESEND_API_KEY` periodically.
- Use least-privilege API keys for production.
