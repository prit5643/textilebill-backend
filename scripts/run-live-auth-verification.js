const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.LIVE_API_BASE_URL || 'http://localhost:3001/api';
const FRONTEND_ORIGIN =
  process.env.LIVE_FRONTEND_ORIGIN || 'http://localhost:3000';
const REPORT_FILE =
  process.env.LIVE_AUTH_REPORT_FILE ||
  path.resolve(
    __dirname,
    '../docs/live-auth-runtime-report.json',
  );

const FIXTURES = {
  tenant: {
    id: 'auth-live-tenant',
  },
  companies: {
    primary: {
      id: 'auth-live-company-primary',
      name: 'Auth Live Primary',
      productName: 'Auth Primary Fabric',
      accountName: 'Auth Primary Debtor',
    },
    secondary: {
      id: 'auth-live-company-secondary',
      name: 'Auth Live Secondary',
      productName: 'Auth Secondary Fabric',
      accountName: 'Auth Secondary Debtor',
    },
  },
  users: {
    superAdmin: {
      username: 'live-superadmin',
      password: 'Admin@123',
    },
    owner: {
      username: 'live-owner',
      defaultPassword: 'Owner@123',
      alternatePassword: 'Owner@123#2',
    },
    staff: {
      username: 'live-staff',
      password: 'User@123',
    },
  },
};

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
    const setCookieHeaders = getSetCookieHeaders(headers);

    for (const setCookie of setCookieHeaders) {
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
    const value = this.cookies.get(name);
    return Boolean(value);
  }
}

function splitCombinedSetCookieHeader(rawHeader) {
  return rawHeader.split(/,(?=[^;,\s]+=)/g);
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const rawHeader = headers.get('set-cookie');
  if (!rawHeader) {
    return [];
  }

  return splitCombinedSetCookieHeader(rawHeader);
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }

  return payload;
}

function getItems(payload) {
  const unwrapped = unwrap(payload);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }

  if (
    unwrapped &&
    typeof unwrapped === 'object' &&
    Array.isArray(unwrapped.data)
  ) {
    return unwrapped.data;
  }

  return [];
}

function ensure(condition, message, context) {
  if (!condition) {
    const error = new Error(message);
    error.context = context;
    throw error;
  }
}

async function waitForBackendReady() {
  const timeoutMs = 30_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          origin: FRONTEND_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ username: 'not-real', password: 'not-real' }),
      });

      if (response.status === 401 || response.status === 400) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`Backend did not become ready at ${BASE_URL}`);
}

async function apiRequest(pathname, options = {}) {
  const {
    method = 'GET',
    body,
    companyId,
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

  if (companyId) {
    headers['x-company-id'] = companyId;
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

async function detectOwnerPassword() {
  const candidates = [
    FIXTURES.users.owner.defaultPassword,
    FIXTURES.users.owner.alternatePassword,
  ];

  for (const password of candidates) {
    const jar = new CookieJar('owner-detect');
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      jar,
      body: {
        username: FIXTURES.users.owner.username,
        password,
      },
    });

    if (response.ok) {
      return password;
    }
  }

  throw new Error(
    'Unable to log in as live-owner. Run npm run db:bootstrap:auth-live first.',
  );
}

async function getAuthSession(jar) {
  return apiRequest('/auth/me', { jar });
}

async function loginAs(username, password, label) {
  const jar = new CookieJar(label);
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    jar,
    body: { username, password },
  });

  ensure(response.ok, `Login failed for ${username}`, {
    status: response.status,
    body: response.body,
  });

  ensure(jar.has('tb_access'), `${label} missing tb_access cookie`);
  ensure(jar.has('tb_session'), `${label} missing tb_session cookie`);
  ensure(jar.has('tb_refresh'), `${label} missing tb_refresh cookie`);

  return jar;
}

async function findUserByUsername(ownerJar, username) {
  const response = await apiRequest('/users?page=1&limit=100', { jar: ownerJar });
  ensure(response.ok, 'Unable to list users', response);
  const user = getItems(response.raw).find((item) => item.username === username);
  ensure(user, `User ${username} not found in /users response`);
  return user;
}

async function run() {
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    frontendOrigin: FRONTEND_ORIGIN,
    checks: [],
    notes: [
      'This verifier exercises live backend cookie/session behavior. Browser-only UI checks are documented separately in docs/testing/2026-03-12-auth-live-browser-qa.md.',
      'Session-specific revoke immediately kills refresh token use, but the current access JWT may continue until expiry. Immediate forced logout is covered here through password change, user deactivation, and tenant deactivation.',
    ],
  };

  let currentOwnerPassword = null;
  let ownerA = null;
  let ownerB = null;
  let ownerFinal = null;
  let staff = null;
  let superAdmin = null;

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

  async function cleanup() {
    try {
      if (!superAdmin) {
        superAdmin = await loginAs(
          FIXTURES.users.superAdmin.username,
          FIXTURES.users.superAdmin.password,
          'cleanup-super-admin',
        );
      }

      await apiRequest(`/admin/tenants/${FIXTURES.tenant.id}/toggle`, {
        method: 'PATCH',
        jar: superAdmin,
        body: { isActive: true },
      });
    } catch {}

    try {
      const activePassword =
        currentOwnerPassword ||
        (await detectOwnerPassword());
      const ownerCleanup = await loginAs(
        FIXTURES.users.owner.username,
        activePassword,
        'cleanup-owner',
      );
      const staffUser = await findUserByUsername(
        ownerCleanup,
        FIXTURES.users.staff.username,
      );

      await apiRequest(`/users/${staffUser.id}`, {
        method: 'PATCH',
        jar: ownerCleanup,
        body: { isActive: true },
      });

      if (activePassword !== FIXTURES.users.owner.defaultPassword) {
        await apiRequest('/auth/change-password', {
          method: 'POST',
          jar: ownerCleanup,
          body: {
            currentPassword: activePassword,
            newPassword: FIXTURES.users.owner.defaultPassword,
          },
        });
        currentOwnerPassword = FIXTURES.users.owner.defaultPassword;
      }
    } catch {}
  }

  try {
    await step('backend readiness', async () => {
      await waitForBackendReady();
      return { baseUrl: BASE_URL };
    });

    currentOwnerPassword = await detectOwnerPassword();

    await step('bootstrap users can log in and receive auth cookies', async () => {
      superAdmin = await loginAs(
        FIXTURES.users.superAdmin.username,
        FIXTURES.users.superAdmin.password,
        'super-admin',
      );
      ownerA = await loginAs(
        FIXTURES.users.owner.username,
        currentOwnerPassword,
        'owner-a',
      );
      ownerB = await loginAs(
        FIXTURES.users.owner.username,
        currentOwnerPassword,
        'owner-b',
      );
      staff = await loginAs(
        FIXTURES.users.staff.username,
        FIXTURES.users.staff.password,
        'staff',
      );

      return {
        ownerPasswordDetected: currentOwnerPassword,
        cookiesIssued: ['tb_access', 'tb_session', 'tb_refresh'],
      };
    });

    await step('owner session bootstrap returns two active companies', async () => {
      const response = await getAuthSession(ownerA);
      ensure(response.ok, '/auth/me failed for owner', response);
      ensure(response.body.user.username === FIXTURES.users.owner.username);
      ensure(
        Array.isArray(response.body.companies) &&
          response.body.companies.length >= 2,
        'Owner does not have both companies in /auth/me',
        response.body,
      );

      return {
        companies: response.body.companies.map((company) => company.name),
      };
    });

    await step('same account can hold multiple browser sessions', async () => {
      const response = await apiRequest('/auth/sessions', { jar: ownerA });
      ensure(response.ok, 'Unable to list owner sessions', response);
      ensure(
        Array.isArray(response.body) && response.body.length >= 2,
        'Expected at least two active sessions for live-owner',
        response.body,
      );

      return {
        activeSessionCount: response.body.length,
      };
    });

    await step('logout only ends the current browser session', async () => {
      const logoutResponse = await apiRequest('/auth/logout', {
        method: 'POST',
        jar: ownerA,
      });
      ensure(logoutResponse.ok, 'Logout failed for owner-a', logoutResponse);

      const ownerAFollowUp = await getAuthSession(ownerA);
      ensure(
        ownerAFollowUp.status === 401,
        'Logged-out browser should no longer access /auth/me',
        ownerAFollowUp,
      );

      const ownerBFollowUp = await getAuthSession(ownerB);
      ensure(
        ownerBFollowUp.ok,
        'Second browser session should remain active after first logs out',
        ownerBFollowUp,
      );

      ownerA = await loginAs(
        FIXTURES.users.owner.username,
        currentOwnerPassword,
        'owner-a-restored',
      );

      return {
        ownerALogoutStatus: logoutResponse.status,
        ownerAFollowUpStatus: ownerAFollowUp.status,
        ownerBFollowUpStatus: ownerBFollowUp.status,
      };
    });

    await step('company-scoped data stays isolated across concurrent owner sessions', async () => {
      const [
        primaryProducts,
        secondaryProducts,
        primaryAccounts,
        secondaryAccounts,
      ] = await Promise.all([
        apiRequest(
          `/products?page=1&limit=20&search=${encodeURIComponent(
            FIXTURES.companies.primary.productName,
          )}`,
          {
            jar: ownerA,
            companyId: FIXTURES.companies.primary.id,
          },
        ),
        apiRequest(
          `/products?page=1&limit=20&search=${encodeURIComponent(
            FIXTURES.companies.secondary.productName,
          )}`,
          {
            jar: ownerB,
            companyId: FIXTURES.companies.secondary.id,
          },
        ),
        apiRequest(
          `/accounts?page=1&limit=20&search=${encodeURIComponent(
            FIXTURES.companies.primary.accountName,
          )}`,
          {
            jar: ownerA,
            companyId: FIXTURES.companies.primary.id,
          },
        ),
        apiRequest(
          `/accounts?page=1&limit=20&search=${encodeURIComponent(
            FIXTURES.companies.secondary.accountName,
          )}`,
          {
            jar: ownerB,
            companyId: FIXTURES.companies.secondary.id,
          },
        ),
      ]);

      ensure(primaryProducts.ok, 'Primary products request failed', primaryProducts);
      ensure(
        secondaryProducts.ok,
        'Secondary products request failed',
        secondaryProducts,
      );
      ensure(primaryAccounts.ok, 'Primary accounts request failed', primaryAccounts);
      ensure(
        secondaryAccounts.ok,
        'Secondary accounts request failed',
        secondaryAccounts,
      );

      ensure(
        getItems(primaryProducts.raw).some(
          (item) => item.name === FIXTURES.companies.primary.productName,
        ),
        'Primary product not visible in primary company scope',
        primaryProducts.body,
      );
      ensure(
        getItems(secondaryProducts.raw).some(
          (item) => item.name === FIXTURES.companies.secondary.productName,
        ),
        'Secondary product not visible in secondary company scope',
        secondaryProducts.body,
      );
      ensure(
        getItems(primaryAccounts.raw).some(
          (item) => item.name === FIXTURES.companies.primary.accountName,
        ),
        'Primary account not visible in primary company scope',
        primaryAccounts.body,
      );
      ensure(
        getItems(secondaryAccounts.raw).some(
          (item) => item.name === FIXTURES.companies.secondary.accountName,
        ),
        'Secondary account not visible in secondary company scope',
        secondaryAccounts.body,
      );

      return {
        ownerAPrimaryCompany: FIXTURES.companies.primary.name,
        ownerBSecondaryCompany: FIXTURES.companies.secondary.name,
      };
    });

    await step('staff user is restricted to the assigned company only', async () => {
      const companiesResponse = await apiRequest('/companies?page=1&limit=20', {
        jar: staff,
      });
      ensure(companiesResponse.ok, 'Staff company list failed', companiesResponse);

      const companyItems = getItems(companiesResponse.raw);
      ensure(
        companyItems.length === 1 &&
          companyItems[0].id === FIXTURES.companies.primary.id,
        'Staff should only see the primary company',
        companyItems,
      );

      const primaryProducts = await apiRequest('/products?page=1&limit=20', {
        jar: staff,
        companyId: FIXTURES.companies.primary.id,
      });
      const secondaryProducts = await apiRequest('/products?page=1&limit=20', {
        jar: staff,
        companyId: FIXTURES.companies.secondary.id,
      });

      ensure(primaryProducts.ok, 'Staff primary company access failed', primaryProducts);
      ensure(
        secondaryProducts.status === 403,
        'Staff should be denied from the secondary company',
        secondaryProducts,
      );

      return {
        visibleCompanyIds: companyItems.map((company) => company.id),
        deniedStatus: secondaryProducts.status,
      };
    });

    await step('password change invalidates older sessions and refresh tokens', async () => {
      const nextPassword =
        currentOwnerPassword === FIXTURES.users.owner.defaultPassword
          ? FIXTURES.users.owner.alternatePassword
          : FIXTURES.users.owner.defaultPassword;

      const changeResponse = await apiRequest('/auth/change-password', {
        method: 'POST',
        jar: ownerB,
        body: {
          currentPassword: currentOwnerPassword,
          newPassword: nextPassword,
        },
      });
      ensure(changeResponse.ok, 'Password change failed', changeResponse);

      const ownerAFollowUp = await getAuthSession(ownerA);
      ensure(
        [401, 403].includes(ownerAFollowUp.status),
        'Older session should be invalid after password change',
        ownerAFollowUp,
      );

      const ownerARefresh = await apiRequest('/auth/refresh', {
        method: 'POST',
        jar: ownerA,
        body: {},
      });
      ensure(
        ownerARefresh.status === 401,
        'Revoked refresh token should fail after password change',
        ownerARefresh,
      );

      const oldLogin = await apiRequest('/auth/login', {
        method: 'POST',
        body: {
          username: FIXTURES.users.owner.username,
          password: currentOwnerPassword,
        },
      });
      ensure(
        oldLogin.status === 401,
        'Old password should no longer work after change-password',
        oldLogin,
      );

      ownerFinal = await loginAs(
        FIXTURES.users.owner.username,
        nextPassword,
        'owner-final',
      );

      const restoreResponse = await apiRequest('/auth/change-password', {
        method: 'POST',
        jar: ownerFinal,
        body: {
          currentPassword: nextPassword,
          newPassword: currentOwnerPassword,
        },
      });
      ensure(
        restoreResponse.ok,
        'Failed to restore owner password to the baseline value',
        restoreResponse,
      );

      ownerFinal = await loginAs(
        FIXTURES.users.owner.username,
        currentOwnerPassword,
        'owner-final-restored',
      );

      return {
        changedTo: nextPassword,
        restoredTo: currentOwnerPassword,
        invalidatedStatuses: {
          authMe: ownerAFollowUp.status,
          refresh: ownerARefresh.status,
          oldLogin: oldLogin.status,
        },
      };
    });

    await step('user deactivation blocks the next protected request immediately', async () => {
      const staffUser = await findUserByUsername(
        ownerFinal,
        FIXTURES.users.staff.username,
      );

      const deactivateResponse = await apiRequest(`/users/${staffUser.id}`, {
        method: 'DELETE',
        jar: ownerFinal,
      });
      ensure(
        deactivateResponse.ok,
        'Failed to deactivate live-staff',
        deactivateResponse,
      );

      const staffFollowUp = await getAuthSession(staff);
      ensure(
        staffFollowUp.status === 403,
        'Deactivated user should be blocked on the next protected request',
        staffFollowUp,
      );

      const reactivateResponse = await apiRequest(`/users/${staffUser.id}`, {
        method: 'PATCH',
        jar: ownerFinal,
        body: { isActive: true },
      });
      ensure(
        reactivateResponse.ok,
        'Failed to reactivate live-staff after verification',
        reactivateResponse,
      );

      staff = await loginAs(
        FIXTURES.users.staff.username,
        FIXTURES.users.staff.password,
        'staff-reactivated',
      );

      return {
        deactivatedStatus: staffFollowUp.status,
        reactivated: true,
      };
    });

    await step('tenant deactivation blocks tenant users while superadmin remains active', async () => {
      const deactivateTenant = await apiRequest(
        `/admin/tenants/${FIXTURES.tenant.id}/toggle`,
        {
          method: 'PATCH',
          jar: superAdmin,
          body: { isActive: false },
        },
      );
      ensure(
        deactivateTenant.ok,
        'Failed to deactivate auth-live tenant',
        deactivateTenant,
      );

      const ownerFollowUp = await getAuthSession(ownerFinal);
      ensure(
        ownerFollowUp.status === 403,
        'Tenant user should be blocked while tenant is inactive',
        ownerFollowUp,
      );

      const superAdminFollowUp = await getAuthSession(superAdmin);
      ensure(
        superAdminFollowUp.ok,
        'Super admin should stay active while tenant is toggled',
        superAdminFollowUp,
      );

      const reactivateTenant = await apiRequest(
        `/admin/tenants/${FIXTURES.tenant.id}/toggle`,
        {
          method: 'PATCH',
          jar: superAdmin,
          body: { isActive: true },
        },
      );
      ensure(
        reactivateTenant.ok,
        'Failed to reactivate auth-live tenant',
        reactivateTenant,
      );

      ownerFinal = await loginAs(
        FIXTURES.users.owner.username,
        currentOwnerPassword,
        'owner-post-tenant-reactivation',
      );

      return {
        tenantBlockedStatus: ownerFollowUp.status,
        superAdminStatus: superAdminFollowUp.status,
      };
    });

    report.summary = {
      status: 'PASS',
      passedChecks: report.checks.filter((check) => check.status === 'PASS').length,
      failedChecks: 0,
    };
  } catch (error) {
    report.summary = {
      status: 'FAIL',
      passedChecks: report.checks.filter((check) => check.status === 'PASS').length,
      failedChecks: report.checks.filter((check) => check.status === 'FAIL').length,
      message: error.message,
    };
    process.exitCode = 1;
  } finally {
    await cleanup();
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`REPORT_FILE=${REPORT_FILE}`);
  }
}

run().catch((error) => {
  console.error('[live-auth-verifier] fatal error', error);
  process.exitCode = 1;
});
