import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  enabled: process.env.WHATSAPP_ENABLED === 'true',
  provider: process.env.WHATSAPP_PROVIDER ?? 'generic',
  apiUrl: process.env.WHATSAPP_API_URL,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  from: process.env.WHATSAPP_FROM,
  templateName: process.env.WHATSAPP_TEMPLATE_NAME,
  templateLanguageCode: process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE ?? 'en',
  timeoutMs: process.env.WHATSAPP_TIMEOUT_MS
    ? parseInt(process.env.WHATSAPP_TIMEOUT_MS, 10)
    : 10000,
}));