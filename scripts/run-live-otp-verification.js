const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.LIVE_API_BASE_URL || 'http://localhost:3001/api';
const FRONTEND_ORIGIN =
  process.env.LIVE_FRONTEND_ORIGIN || 'http://localhost:3000';
const REPORT_FILE =
  process.env.LIVE_OTP_REPORT_FILE ||
  path.resolve(__dirname, '../docs/live-otp-runtime-report.json');

const LIVE_OTP_IDENTIFIER = process.env.LIVE_OTP_IDENTIFIER;
const LIVE_OTP_CHANNEL = process.env.LIVE_OTP_CHANNEL || 'AUTO';
const LIVE_OTP_CODE = process.env.LIVE_OTP_CODE;
const LIVE_AUTH_USERNAME = process.env.LIVE_AUTH_USERNAME;
const LIVE_AUTH_PASSWORD = process.env.LIVE_AUTH_PASSWORD;
const LIVE_CONTACT_CHANNEL = process.env.LIVE_CONTACT_CHANNEL;
const LIVE_CONTACT_OTP_CODE = process.env.LIVE_CONTACT_OTP_CODE;

class CookieJar {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  apply(headers) {
    const cookieHeader = [...this.cookies.entries()]
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
  }

  storeFrom(headers) {
    const rawHeader = headers.get('set-cookie');
    if (!rawHeader) {
      return;
    }

    for (const setCookie of rawHeader.split(/,(?=[^;,\s]+=)/g)) {
      const [cookiePair, ...attributeParts] = setCookie.split(';');
      const separatorIndex = cookiePair.indexOf('=');
      if (separatorIndex < 0) {
        continue;
      }

      const name = cookiePair.slice(0, separatorIndex).trim();
      const value = cookiePair.slice(separatorIndex + 1).trim();
      const normalizedAttributes = attributeParts.map((part) =>
        part.trim().toLowerCase(),
      );
      const isExpired =
        value === '' ||
        normalizedAttributes.includes('max-age=0') ||
        normalizedAttributes.some((part) =>
          part.startsWith('expires=thu, 01 jan 1970'),
        );

      if (isExpired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  has(name) {
    return Boolean(this.cookies.get(name));
  }
}

function ensure(condition, message, context) {
  if (!condition) {
    const error = new Error(message);
    error.context = context;
    throw error;
  }
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }

  return payload;
}

async function apiRequest(pathname, options = {}) {
  const {
    method = 'GET',
    body,
    jar,
    headers: extraHeaders,
  } = options;

  const headers = {
    accept: 'application/json',
    ...(extraHeaders || {}),
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (method !== 'GET' && !headers.origin) {
    headers.origin = FRONTEND_ORIGIN;
  }

  if (jar) {
    jar.apply(headers);
  }

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  if (jar) {
    jar.storeFrom(response.headers);
  }

  let json = null;
  try {
    json = await response.json();
  } catch {}

  return {
    ok: response.ok,
    status: response.status,
    body: unwrap(json),
    raw: json,
  };
}

async function loginWithPassword(username, password) {
  const jar = new CookieJar('password-login');
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    jar,
    body: { username, password },
  });

  ensure(response.ok, 'Password login failed', response);
  ensure(jar.has('tb_access'), 'Password login did not set tb_access cookie');
  return jar;
}

async function run() {
  ensure(
    LIVE_OTP_IDENTIFIER,
    'Set LIVE_OTP_IDENTIFIER before running the live OTP verifier.',
  );

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    frontendOrigin: FRONTEND_ORIGIN,
    checks: [],
    notes: [
      'Provide LIVE_OTP_CODE only after you receive the OTP from email or WhatsApp.',
      'Provide LIVE_CONTACT_OTP_CODE only after the authenticated contact verification request succeeds.',
    ],
  };

  let authenticatedJar = null;
  let loginRequestId = null;
  let contactRequestId = null;

  async function step(name, fn) {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      report.checks.push({
        name,
        status: 'PASS',
        durationMs: Date.now() - startedAt,
        detail,
      });
    } catch (error) {
      report.checks.push({
        name,
        status: 'FAIL',
        durationMs: Date.now() - startedAt,
        detail: {
          message: error.message,
          context: error.context || null,
        },
      });
      throw error;
    }
  }

  try {
    await step('request-login-otp', async () => {
      const response = await apiRequest('/auth/otp/request', {
        method: 'POST',
        body: {
          identifier: LIVE_OTP_IDENTIFIER,
          channel: LIVE_OTP_CHANNEL,
        },
      });

      ensure(response.ok, 'OTP request failed', response);
      ensure(response.body.requestId, 'OTP request did not return requestId', response.body);
      loginRequestId = response.body.requestId;

      return {
        requestId: response.body.requestId,
        channel: response.body.channel,
        targetHint: response.body.targetHint,
      };
    });

    if (LIVE_OTP_CODE) {
      await step('verify-login-otp', async () => {
        const jar = new CookieJar('otp-login');
        const response = await apiRequest('/auth/otp/verify', {
          method: 'POST',
          jar,
          body: {
            requestId: loginRequestId,
            otp: LIVE_OTP_CODE,
          },
        });

        ensure(response.ok, 'OTP verification failed', response);
        ensure(jar.has('tb_access'), 'OTP verification did not set tb_access cookie');
        authenticatedJar = jar;

        return {
          userId: response.body?.user?.id,
          hasVerifiedContact: response.body?.user?.hasVerifiedContact,
        };
      });

      await step('fetch-verification-status', async () => {
        const response = await apiRequest('/auth/verification-status', {
          jar: authenticatedJar,
        });

        ensure(response.ok, 'Failed to fetch verification status', response);
        return response.body;
      });
    } else {
      report.checks.push({
        name: 'verify-login-otp',
        status: 'SKIP',
        durationMs: 0,
        detail: {
          message: 'Set LIVE_OTP_CODE after receiving the OTP to complete login verification.',
        },
      });
    }

    if (!authenticatedJar && LIVE_AUTH_USERNAME && LIVE_AUTH_PASSWORD) {
      await step('password-login-for-contact-verification', async () => {
        authenticatedJar = await loginWithPassword(
          LIVE_AUTH_USERNAME,
          LIVE_AUTH_PASSWORD,
        );
        return { username: LIVE_AUTH_USERNAME };
      });
    }

    if (LIVE_CONTACT_CHANNEL && authenticatedJar) {
      await step('request-contact-verification', async () => {
        const response = await apiRequest('/auth/verify-contact/request', {
          method: 'POST',
          jar: authenticatedJar,
          body: {
            channel: LIVE_CONTACT_CHANNEL,
          },
        });

        ensure(response.ok, 'Contact verification request failed', response);
        ensure(
          response.body.requestId,
          'Contact verification request did not return requestId',
          response.body,
        );
        contactRequestId = response.body.requestId;

        return {
          requestId: response.body.requestId,
          channel: response.body.channel,
          targetHint: response.body.targetHint,
        };
      });

      if (LIVE_CONTACT_OTP_CODE) {
        await step('confirm-contact-verification', async () => {
          const response = await apiRequest('/auth/verify-contact/confirm', {
            method: 'POST',
            jar: authenticatedJar,
            body: {
              requestId: contactRequestId,
              otp: LIVE_CONTACT_OTP_CODE,
            },
          });

          ensure(response.ok, 'Contact OTP confirmation failed', response);
          return response.body;
        });
      } else {
        report.checks.push({
          name: 'confirm-contact-verification',
          status: 'SKIP',
          durationMs: 0,
          detail: {
            message:
              'Set LIVE_CONTACT_OTP_CODE after receiving the contact verification OTP to confirm it.',
          },
        });
      }
    } else if (LIVE_CONTACT_CHANNEL) {
      report.checks.push({
        name: 'request-contact-verification',
        status: 'SKIP',
        durationMs: 0,
        detail: {
          message:
            'Set LIVE_OTP_CODE or LIVE_AUTH_USERNAME/LIVE_AUTH_PASSWORD to authenticate before requesting contact verification.',
        },
      });
    }
  } finally {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  }

  console.log(`Live OTP verification report written to ${REPORT_FILE}`);
}

run().catch((error) => {
  console.error(error.message);
  if (error.context) {
    console.error(JSON.stringify(error.context, null, 2));
  }
  process.exitCode = 1;
});
