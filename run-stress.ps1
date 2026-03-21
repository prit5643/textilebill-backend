$ErrorActionPreference = 'Stop'

$ready = $false
1..100 | ForEach-Object {
  try {
    Invoke-WebRequest -Uri 'http://localhost:3001/api/auth/login' -Method Post -ContentType 'application/json' -Body '{"username":"x","password":"y"}' -TimeoutSec 2 | Out-Null
  } catch {
    if ($_.Exception.Response -and ($_.Exception.Response.StatusCode.value__ -in 400, 401)) {
      $ready = $true
    }
  }
  if ($ready) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $ready) {
  throw 'Server not ready for stress run'
}

$js = @'
const base = 'http://localhost:3001/api';
function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }
function unwrap(json) { return (json && typeof json === 'object' && 'data' in json) ? json.data : json; }
async function api(path, { method = 'GET', token, body, companyId } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (companyId) headers['x-company-id'] = companyId;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body: unwrap(json) };
}
function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
async function runLoad(name, total, concurrency, task) {
  let idx = 0;
  const lat = [];
  let ok = 0;
  let fail = 0;
  const statuses = new Map();
  async function worker() {
    while (true) {
      const n = idx++;
      if (n >= total) break;
      const t0 = nowMs();
      try {
        const r = await task(n);
        const dt = nowMs() - t0;
        lat.push(dt);
        const code = r?.status ?? 0;
        statuses.set(code, (statuses.get(code) || 0) + 1);
        if (r?.ok) ok++; else fail++;
      } catch {
        const dt = nowMs() - t0;
        lat.push(dt);
        statuses.set(-1, (statuses.get(-1) || 0) + 1);
        fail++;
      }
    }
  }
  const tStart = nowMs();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const tTotal = Math.max(1, nowMs() - tStart);
  return {
    name, total, concurrency, ok, fail,
    rps: Number((total / (tTotal / 1000)).toFixed(2)),
    latency_ms: {
      min: Math.min(...lat),
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
      max: Math.max(...lat),
      avg: Number((lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2)),
    },
    statuses: Object.fromEntries([...statuses.entries()].sort((a, b) => a[0] - b[0])),
  };
}
(async () => {
  const nonce = Date.now();
  const superLogin = await api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: 'Admin@123456' } });
  if (!superLogin.ok) throw new Error(`superadmin login failed ${superLogin.status}`);
  const superToken = superLogin.body.accessToken;
  const plansRes = await api('/admin/plans', { token: superToken });
  const plans = Array.isArray(plansRes.body) ? plansRes.body : [];
  const planId = plans[0]?.id;
  const slug = `stress${nonce}`;
  const tenantRes = await api('/admin/tenants', {
    method: 'POST', token: superToken,
    body: {
      name: `Stress Tenant ${nonce}`, slug, gstin: '24ABCDE1234F1Z5', address: 'Ring Road', city: 'Surat', state: 'Gujarat',
      pincode: '395001', phone: '+919876543210', email: `${slug}@example.com`, adminFirstName: 'Stress', adminLastName: 'Admin',
      password: 'new.tenant.', planId,
    },
  });
  if (!tenantRes.ok) throw new Error(`create tenant failed ${tenantRes.status}`);
  const tenantUser = tenantRes.body.user.username;
  const tenantPass = tenantRes.body.tempPassword;
  const tenantCompanyId = tenantRes.body.company.id;
  const tAdminLogin = await api('/auth/login', { method: 'POST', body: { username: tenantUser, password: tenantPass } });
  if (!tAdminLogin.ok) throw new Error(`tenant admin login failed ${tAdminLogin.status}`);
  const tAdminToken = tAdminLogin.body.accessToken;
  const newEmail = `stress.user.${nonce}@example.com`;
  const newPass = 'TempPass@123';
  const newUserRes = await api('/users', {
    method: 'POST', token: tAdminToken,
    body: { email: newEmail, password: newPass, role: 'TENANT_ADMIN', firstName: 'Stress', lastName: 'User', phone: '+919999888877', companyIds: [tenantCompanyId] },
  });
  if (!newUserRes.ok) throw new Error(`create user failed ${newUserRes.status}`);
  const userLogin = await api('/auth/login', { method: 'POST', body: { username: newEmail, password: newPass } });
  if (!userLogin.ok) throw new Error(`new user login failed ${userLogin.status}`);
  const userToken = userLogin.body.accessToken;
  const companyRes = await api('/companies', {
    method: 'POST', token: userToken,
    body: { name: `Stress Co ${nonce}`, gstin: '27ABCDE1234F1Z9', city: 'Mumbai', state: 'Maharashtra', phone: '+918888777766', email: `stressco${nonce}@example.com` },
  });
  if (!companyRes.ok) throw new Error(`create company failed ${companyRes.status}`);
  const companyId = companyRes.body.id;
  const accountRes = await api('/accounts', {
    method: 'POST', token: userToken, companyId,
    body: { name: `Stress Customer ${nonce}`, phone: '+917777666655', email: `stresscust${nonce}@example.com`, city: 'Mumbai', state: 'Maharashtra' },
  });
  if (!accountRes.ok) throw new Error(`create account failed ${accountRes.status}`);
  const accountId = accountRes.body.id;
  const productRes = await api('/products', {
    method: 'POST', token: userToken, companyId,
    body: { name: `Stress Product ${nonce}`, retailPrice: 1200, buyingPrice: 900, gstRate: 5, type: 'GOODS', gstConsiderAs: 'TAXABLE' },
  });
  if (!productRes.ok) throw new Error(`create product failed ${productRes.status}`);
  const productId = productRes.body.id;
  const phase1 = await runLoad('login_burst', 120, 20, async () => api('/auth/login', { method: 'POST', body: { username: newEmail, password: newPass } }));
  const phase2 = await runLoad('products_read_burst', 300, 30, async () => api('/products?page=1&limit=20', { token: userToken, companyId }));
  const phase3 = await runLoad('invoice_write_burst', 90, 12, async (i) => api('/invoices', {
    method: 'POST', token: userToken, companyId,
    body: { invoiceType: 'SALE', invoiceDate: new Date().toISOString().slice(0, 10), accountId, narration: `stress-${i}`, items: [{ productId, quantity: 1, rate: 1200, gstRate: 5 }] },
  }));
  const summary = { timestamp: new Date().toISOString(), environment: 'local', setup: { companyId, accountId, productId }, phases: [phase1, phase2, phase3] };
  console.log(JSON.stringify(summary, null, 2));
})();
'@

$tmp = 'E:\Billmanagment\backend\stress-runner.tmp.js'
Set-Content -Path $tmp -Value $js
node $tmp | Tee-Object -FilePath 'E:\Billmanagment\backend\stress-result.json'
Remove-Item $tmp -Force


