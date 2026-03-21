# 🔒 TEXTILLEBILL - COMPREHENSIVE SECURITY & ARCHITECTURE AUDIT REPORT

**Report Date:** March 19, 2026  
**Audited By:** Security & Architecture Analysis System  
**Application:** TextileBill - Multi-tenant Billing & Invoicing SaaS  
**Tech Stack:** NestJS (Backend) + Next.js (Frontend) + PostgreSQL + Redis  

---

## 📊 EXECUTIVE SUMMARY

### Overall Security Rating: **6.5/10** ⚠️
### Architecture Rating: **8/10** ✅

**Status:** The application demonstrates **solid architectural foundations** with well-structured code and proper security practices. However, **3 CRITICAL vulnerabilities** and **several high-severity issues** require immediate remediation before production deployment.

### Critical Issues Requiring Immediate Action:
1. 🔴 **Hardcoded secrets exposed in version control** (.env file with JWT secrets, API keys)
2. 🔴 **Multiple npm security vulnerabilities** (multer DoS, rate-limit bypass, glob injection)
3. 🔴 **Rate limiting bypass via IPv6 mapping** (authentication endpoints vulnerable)

### Key Strengths:
- ✅ Strong password hashing (bcrypt with 12 rounds)
- ✅ Proper JWT token strategy with httpOnly cookies
- ✅ Role-based access control (RBAC) with multi-tenant isolation
- ✅ SQL injection protection via Prisma ORM
- ✅ Comprehensive error message sanitization
- ✅ Well-structured modular architecture

---

## 🎯 VULNERABILITY SUMMARY

| Severity | Backend | Frontend | Total |
|----------|---------|----------|-------|
| 🔴 **CRITICAL** | 3 | 0 | **3** |
| 🟠 **HIGH** | 3 | 0 | **3** |
| 🟡 **MEDIUM** | 8 | 4 | **12** |
| 🟢 **LOW** | 2 | 5 | **7** |
| **TOTAL** | **16** | **9** | **25** |

---

# 🔴 PART 1: CRITICAL SECURITY VULNERABILITIES

## 1. HARDCODED SECRETS IN VERSION CONTROL (CRITICAL)

**Severity:** 🔴 **CRITICAL**  
**Files:** `textilebill-backend/.env`  
**CVSS Score:** 9.1 (Critical)

### Exposed Credentials:
```env
JWT_SECRET=<REDACTED - CHANGE IN PRODUCTION>
JWT_REFRESH_SECRET=<REDACTED - CHANGE IN PRODUCTION>
ADMIN_TENANT_CREATION_PASSWORD=<REDACTED>
MAIL_GMAIL_APP_PASSWORD=<REDACTED>
DATABASE_URL=<REDACTED - LOCAL DATABASE URL WAS EXPOSED>
```

### Impact:
- **Authentication Bypass:** Attackers can forge valid JWT tokens and impersonate any user including admins
- **Email Account Compromise:** Attackers can access your Gmail account and send emails
- **Tenant Creation Abuse:** Attackers can create unauthorized tenant accounts
- **Database Access:** Database credentials visible (though localhost in this case)
- **Complete System Compromise:** Full application takeover possible

### Immediate Actions Required:

#### Step 1: Rotate ALL Secrets (Within 24 Hours)
```bash
# Generate new JWT secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 1. Regenerate Gmail App Password in Google Account settings
# 2. Generate new admin tenant creation password
# 3. Update all environment variables in production
```

#### Step 2: Remove from Git History (Within 48 Hours)
```bash
# Install git-filter-repo
pip install git-filter-repo

# Remove .env file from entire history
git filter-repo --invert-paths --path textilebill-backend/.env

# Force push (WARNING: coordinate with team)
git push origin --force --all
git push origin --force --tags
```

#### Step 3: Implement Secret Management (Week 1)
```typescript
// Use AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });

async function getSecret(secretName: string): Promise<string> {
  const response = await secretsManager.getSecretValue({ SecretId: secretName });
  return JSON.parse(response.SecretString).value;
}

// In configuration
export default registerAs('jwt', async () => ({
  secret: await getSecret('prod/jwt-secret'),
  refreshSecret: await getSecret('prod/jwt-refresh-secret'),
  expiresIn: '15m',
  refreshExpiresIn: '7d',
}));
```

#### Step 4: Add Pre-commit Hooks
```bash
npm install --save-dev husky @commitlint/cli git-secrets

# Initialize husky
npx husky install

# Add pre-commit hook
npx husky add .husky/pre-commit "npx git-secrets --scan"

# Configure git-secrets
git secrets --install
git secrets --register-aws
git secrets --add 'JWT_SECRET=[^\s]+'
git secrets --add 'MAIL_GMAIL_APP_PASSWORD=[^\s]+'
git secrets --add 'password=[^\s]+'
```

---

## 2. NPM DEPENDENCY VULNERABILITIES (CRITICAL/HIGH)

**Severity:** 🔴 **CRITICAL** / 🟠 **HIGH**  
**Location:** `textilebill-backend/package.json`  
**Total Vulnerabilities:** 8 (4 High, 4 Moderate)

### High Severity Vulnerabilities:

#### A. Multer File Upload DoS (CVE: Multiple)
```
Package: multer ≤ 2.1.0
Issue: DoS via incomplete cleanup, resource exhaustion, uncontrolled recursion
GHSA IDs: GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2
Fix: Update to ≥ 2.1.1
```

**Impact:**
- Server crash from malicious file uploads
- Disk space exhaustion
- Memory overflow attacks

**Location:** `src/modules/users/users.controller.ts` (avatar upload)

**Fix:**
```bash
npm install multer@latest
```

#### B. Express-Rate-Limit IPv6 Bypass
```
Package: express-rate-limit ≤ 8.2.1
Issue: IPv4-mapped IPv6 addresses bypass per-client rate limiting
GHSA ID: GHSA-46wh-pxpv-q5gq
Fix: Update to ≥ 8.2.2
```

**Impact:**
- Brute force attacks on login endpoint
- OTP spam attacks
- Password reset abuse
- Authentication bypass via rate limit circumvention

**Location:** `src/modules/auth/auth-rate-limit.util.ts`

**Fix:**
```bash
npm install express-rate-limit@^8.2.2
```

#### C. Glob Command Injection
```
Package: glob
Issue: Command injection via -c/--cmd parameter
GHSA ID: GHSA-5j98-mcp5-4vw2
Fix: Update to ≥ 10.4.6
```

**Impact:** Remote command execution if user input passed to glob

**Fix:**
```bash
npm install glob@latest
```

#### D. Flatted Recursion DoS
```
Package: flatted
Issue: Unbounded recursion DoS in parse()
GHSA ID: GHSA-25h7-pfq9-p65f
Fix: Update immediately
```

**Impact:** Server crash via malicious JSON payload

### Immediate Fix:
```bash
cd textilebill-backend

# Fix all vulnerabilities
npm audit fix --force

# Verify fixes
npm audit

# Run tests to ensure nothing broke
npm test

# Update lockfile
npm install
```

---

## 3. RATE LIMITING BYPASS - IPv6 ATTACK VECTOR (CRITICAL)

**Severity:** 🔴 **CRITICAL**  
**File:** `src/modules/auth/auth-rate-limit.util.ts`  
**Vulnerability:** CVE in express-rate-limit v8.2.0-8.2.1

### Attack Scenario:
```bash
# Attacker uses IPv4-mapped IPv6 addresses to bypass rate limits
curl -X POST https://api.textillebill.com/api/auth/login \
  -H "X-Forwarded-For: ::ffff:192.0.2.1" \
  -d '{"email":"victim@example.com","password":"attempt1"}'

# Each request appears to come from different IP
curl -X POST https://api.textillebill.com/api/auth/login \
  -H "X-Forwarded-For: ::ffff:192.0.2.2" \
  -d '{"email":"victim@example.com","password":"attempt2"}'

# Result: Unlimited login attempts, OTP requests, password resets
```

### Protected Endpoints:
- `POST /auth/login` - 10 attempts per 15 minutes
- `POST /auth/otp/request` - 5 attempts per hour
- `POST /auth/password-reset/request` - 3 attempts per hour

### Fix Implementation:

```typescript
// auth-rate-limit.util.ts - Enhanced version
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request } from 'express';

function getClientIdentifier(req: Request): string {
  // Normalize IPv6 addresses to prevent bypass
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
    : req.ip;
  
  // Convert IPv4-mapped IPv6 to IPv4
  const normalized = ip?.replace(/^::ffff:/, '') || 'unknown';
  
  return normalized;
}

export function createAuthRateLimiters(
  configService: ConfigService,
  apiPrefix: string,
  redisService: RedisService,
): RateLimitedRoute[] {
  const redisClient = redisService.getClient();
  
  return [
    {
      path: `${apiPrefix}/auth/login`,
      middleware: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: new RedisStore({
          client: redisClient,
          prefix: 'rl:login:',
        }),
        keyGenerator: getClientIdentifier, // Use normalized IP
        handler: (req, res) => {
          res.status(429).json({
            statusCode: 429,
            message: 'Too many login attempts. Please try again later.',
          });
        },
      }),
    },
    {
      path: `${apiPrefix}/auth/otp/request`,
      middleware: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5,
        store: new RedisStore({
          client: redisClient,
          prefix: 'rl:otp:',
        }),
        keyGenerator: getClientIdentifier,
      }),
    },
  ];
}
```

---

# 🟠 PART 2: HIGH SEVERITY VULNERABILITIES

## 4. FILE UPLOAD SECURITY - PATH TRAVERSAL & RCE RISK (HIGH)

**Severity:** 🟠 **HIGH**  
**File:** `src/modules/users/users.controller.ts` (lines 71-113)  
**CVSS Score:** 8.1 (High)

### Current Vulnerable Implementation:
```typescript
@UseInterceptors(
  FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req: any, _file: any, cb: any) =>
        cb(null, avatarUploadDir),
      filename: (req: any, file: any, cb: any) => {
        const userId = (req as { user?: { id?: string } }).user?.id || 'user';
        const stamp = Date.now();
        const extension = extname(file.originalname || '').toLowerCase() || '.jpg';
        cb(null, `${userId}-${stamp}${extension}`);
      },
    }),
    fileFilter: (_req: any, file: any, cb: any) => {
      const isImage = file.mimetype?.startsWith('image/');
      if (!isImage) {
        return cb(new BadRequestException('Only image files are allowed'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 2 * 1024 * 1024 },
  }),
)
```

### Vulnerabilities:

#### A. MIME Type Spoofing
```bash
# Attacker uploads PHP shell with fake MIME type
curl -X POST /api/users/avatar \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@malware.php;type=image/jpeg"
  
# File saved as: user123-1234567890.php
# If web server executes PHP: Remote Code Execution
```

#### B. Double Extension Attack
```bash
# Upload: malicious.php.jpg
# Server stores: user123-1234567890.php.jpg
# Some servers execute: .php (first extension)
```

#### C. No File Signature Validation
```bash
# File claims to be image/jpeg
# Actual content: ELF executable or PHP script
# Current code doesn't verify actual file content
```

### Secure Implementation:

```typescript
import { fileTypeFromBuffer } from 'file-type';
import * as sharp from 'sharp';
import { randomUUID } from 'crypto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

@Post('avatar')
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
async uploadMyAvatar(
  @CurrentUser('id') userId: string,
  @CurrentTenant('id') tenantId: string,
  @UploadedFile(
    new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
        new FileTypeValidator({ fileType: /image\/(jpeg|png|webp|gif)/ }),
      ],
    }),
  ) file: Express.Multer.File,
) {
  // Step 1: Verify file is actually an image using magic numbers
  const fileType = await fileTypeFromBuffer(file.buffer);
  if (!fileType || !ALLOWED_MIME_TYPES.includes(fileType.mime)) {
    throw new BadRequestException('File is not a valid image');
  }

  // Step 2: Process image with Sharp (re-encodes, strips EXIF)
  const processedImage = await sharp(file.buffer)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();

  // Step 3: Save with secure filename (no extension from user)
  const filename = `${userId}-${randomUUID()}.webp`;
  const filepath = join(avatarUploadDir, filename);
  
  await fs.promises.writeFile(filepath, processedImage);

  // Step 4: Update user record
  const avatarUrl = `/uploads/avatars/${filename}`;
  return this.usersService.updateMyAvatar(userId, tenantId, avatarUrl);
}
```

### Additional Protections:

```typescript
// Add file upload middleware globally
// main.ts
app.use('/api/users/avatar', (req, res, next) => {
  // Reject double extensions
  const filename = req.file?.originalname || '';
  const parts = filename.split('.');
  if (parts.length > 2) {
    return res.status(400).json({ message: 'Invalid filename' });
  }
  next();
});
```

---

## 5. STATIC FILE SERVING - INFORMATION DISCLOSURE (HIGH)

**Severity:** 🟠 **HIGH**  
**File:** `src/main.ts` (line 71)  
**CVSS Score:** 7.5 (High)

### Current Vulnerable Code:
```typescript
app.use('/uploads', express.static(uploadsDir));
```

### Vulnerabilities:

#### A. Directory Traversal
```bash
# Attacker accesses files outside uploads directory
curl https://api.textillebill.com/uploads/../../../etc/passwd
curl https://api.textillebill.com/uploads/../.env
```

#### B. Directory Listing
```bash
# Some configurations expose directory contents
curl https://api.textillebill.com/uploads/avatars/
# Returns: list of all user avatar filenames
```

#### C. No Access Control
```bash
# Anyone can access any uploaded file
curl https://api.textillebill.com/uploads/avatars/user123-avatar.jpg
# No authentication required
```

### Secure Implementation:

```typescript
// Option 1: Secure static serving with restrictions
import serveStatic from 'serve-static';
import { normalize, join } from 'path';

app.use('/uploads', (req, res, next) => {
  // Prevent directory traversal
  const requestedPath = join(uploadsDir, req.path);
  const normalizedPath = normalize(requestedPath);
  
  if (!normalizedPath.startsWith(normalize(uploadsDir))) {
    return res.status(403).json({ message: 'Access denied' });
  }
  
  // Only allow image files
  if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(req.path)) {
    return res.status(403).json({ message: 'Invalid file type' });
  }
  
  next();
}, serveStatic(uploadsDir, {
  maxAge: '1d',
  etag: true,
  dotfiles: 'deny',
  redirect: false,
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=86400');
  },
}));

// Option 2: Authenticated file serving (RECOMMENDED)
@Controller('uploads')
export class UploadsController {
  @Get('avatars/:filename')
  @UseGuards(JwtAuthGuard) // Require authentication
  async serveAvatar(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    // Validate filename format
    if (!/^[a-f0-9-]+\.webp$/i.test(filename)) {
      throw new BadRequestException('Invalid filename');
    }
    
    const filepath = join(avatarUploadDir, filename);
    const normalized = normalize(filepath);
    
    // Prevent directory traversal
    if (!normalized.startsWith(normalize(avatarUploadDir))) {
      throw new BadRequestException('Access denied');
    }
    
    // Check file exists
    if (!existsSync(filepath)) {
      throw new NotFoundException('File not found');
    }
    
    // Security headers
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'image/webp');
    
    return res.sendFile(filepath);
  }
}
```

---

## 6. SENDGRID API KEY EXPOSED (HIGH)

**Severity:** 🟠 **HIGH** (Combined with Critical #1)  
**File:** `textilebill-backend/.env` (lines 67-68)  

### Exposed Credentials:
```env
SENDGRID_API_KEY=<REDACTED - API KEY WAS EXPOSED>
SENDGRID_PASSWORD_RESET_TEMPLATE_ID=<REDACTED>
```

### Attack Scenarios:
1. **Phishing Campaigns:** Send emails appearing to be from textillebill.com
2. **Reputation Damage:** Spam sent from your domain → blacklisted
3. **Financial Cost:** Unlimited email sending on your account
4. **Data Harvesting:** Access to SendGrid analytics and recipient data

### Immediate Actions:

```bash
# 1. Revoke API key in SendGrid console immediately
# 2. Generate new API key with MINIMUM permissions:
#    - Mail Send (only)
#    - NO access to contacts, templates, or analytics

# 3. Add IP whitelist if possible
# 4. Enable 2FA on SendGrid account
```

### Secure Configuration:

```typescript
// mail.config.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

export default registerAs('mail', async () => {
  const apiKey = process.env.NODE_ENV === 'production'
    ? await getSecretFromVault('sendgrid-api-key')
    : process.env.SENDGRID_API_KEY;
    
  if (!apiKey || !apiKey.startsWith('SG.')) {
    throw new Error('Invalid SendGrid API key format');
  }
  
  return {
    apiKey,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@textillebill.com',
    fromName: 'TextileBill',
    passwordResetTemplateId: process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID,
  };
});

// Add rate limiting for email sending
@Injectable()
export class MailService {
  private readonly dailyEmailLimit = 1000;
  
  async sendPasswordReset(email: string, token: string) {
    // Check daily limit
    const sent = await this.redis.get(`email:count:${new Date().toDateString()}`);
    if (sent && parseInt(sent) >= this.dailyEmailLimit) {
      throw new Error('Daily email limit reached');
    }
    
    await this.sendgridClient.send({...});
    
    // Increment counter
    await this.redis.incr(`email:count:${new Date().toDateString()}`);
    await this.redis.expire(`email:count:${new Date().toDateString()}`, 86400);
  }
}
```

---

# 🟡 PART 3: MEDIUM SEVERITY ISSUES

## 7. MISSING CSRF PROTECTION (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**Location:** Backend API + Frontend  
**Impact:** State-changing operations vulnerable to CSRF attacks

### Current Protection:
- ✅ SameSite cookies configured
- ✅ CORS enabled with origin validation
- ❌ No explicit CSRF tokens

### Attack Scenario:
```html
<!-- Malicious website: evil.com -->
<form action="https://api.textillebill.com/api/invoices" method="POST">
  <input type="hidden" name="amount" value="99999">
  <input type="hidden" name="customerId" value="victim-customer">
</form>
<script>
  document.forms[0].submit();
</script>
```

### Implementation:

```typescript
// csrf.service.ts
import { Injectable } from '@nestjs/common';
import { randomBytes, createHmac } from 'crypto';

@Injectable()
export class CsrfService {
  private readonly secret = process.env.CSRF_SECRET;
  
  generateToken(sessionId: string): string {
    const token = randomBytes(32).toString('hex');
    const signature = createHmac('sha256', this.secret)
      .update(`${sessionId}:${token}`)
      .digest('hex');
    
    return `${token}.${signature}`;
  }
  
  validateToken(sessionId: string, token: string): boolean {
    const [tokenPart, signaturePart] = token.split('.');
    
    const expectedSignature = createHmac('sha256', this.secret)
      .update(`${sessionId}:${tokenPart}`)
      .digest('hex');
    
    return signaturePart === expectedSignature;
  }
}

// csrf.guard.ts
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private csrfService: CsrfService) {}
  
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }
    
    const sessionId = request.user?.sessionId;
    const token = request.headers['x-csrf-token'];
    
    if (!token || !this.csrfService.validateToken(sessionId, token)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    
    return true;
  }
}

// main.ts
app.useGlobalGuards(new CsrfGuard(app.get(CsrfService)));
```

**Frontend:**
```typescript
// src/lib/api-client.ts
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await axios.get('/api/auth/csrf-token');
    csrfToken = res.data.token;
  }
  return csrfToken;
}

apiClient.interceptors.request.use(async (config) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method?.toUpperCase())) {
    config.headers['X-CSRF-Token'] = await getCsrfToken();
  }
  return config;
});
```

---

## 8. CONTENT SECURITY POLICY NOT CONFIGURED (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**Location:** Frontend - `next.config.mjs` & Backend headers  
**Impact:** Weak defense against XSS attacks

### Current State:
```typescript
// next.config.mjs
export default {};  // Empty configuration
```

### Secure Implementation:

```typescript
// middleware.ts (Frontend)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-eval in dev
    "style-src 'self' 'unsafe-inline'", // Required for Tailwind
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' " + process.env.NEXT_PUBLIC_API_URL,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  
  response.headers.set('Content-Security-Policy', csp);
  
  // Other security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

**Backend:**
```typescript
// main.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```

---

## 9. DATABASE CONNECTION NOT ENCRYPTED (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**File:** `src/config/database.config.ts`  

### Current Configuration:
```env
DATABASE_URL=postgresql://jenishkheni@localhost:5432/textilebill
# No SSL/TLS specified
```

### Risk:
- Credentials transmitted in plaintext over network
- Man-in-the-middle attacks possible
- Regulatory compliance issues (GDPR, PCI-DSS require encrypted connections)

### Secure Configuration:

```typescript
// database.config.ts
export default registerAs('database', () => {
  const url = process.env.DATABASE_URL;
  const nodeEnv = process.env.NODE_ENV;
  
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  
  // Enforce SSL in production
  const finalUrl = nodeEnv === 'production'
    ? url.includes('?')
      ? `${url}&sslmode=require&sslrootcert=/path/to/ca-cert.pem`
      : `${url}?sslmode=require&sslrootcert=/path/to/ca-cert.pem`
    : url;
  
  return {
    url: finalUrl,
    directUrl: process.env.DATABASE_DIRECT_URL,
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
    },
  };
});
```

**Production .env:**
```env
DATABASE_URL=postgresql://user:password@prod-db.example.com:5432/textilebill?sslmode=require&sslrootcert=/etc/ssl/certs/ca-bundle.crt
```

---

## 10. WEAK ADMIN TENANT CREATION PASSWORD (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**File:** `src/modules/admin/admin.service.ts` (lines 162-177)  

### Current Implementation:
```typescript
if (dto.password !== tenantCreationPassword) {
  throw new BadRequestException('Invalid tenant creation password');
}
```

### Issues:
1. Plain text comparison (no hashing)
2. Single password for all tenant creation
3. No rate limiting specific to this endpoint
4. No audit logging of failed attempts

### Secure Implementation:

```typescript
// admin.service.ts
import * as bcrypt from 'bcrypt';

async createTenant(dto: CreateTenantDto, ip: string) {
  const tenantCreationPasswordHash = this.configService.get<string>(
    'ADMIN_TENANT_CREATION_PASSWORD_HASH',
  );
  
  // Use bcrypt for comparison
  const passwordMatch = await bcrypt.compare(
    dto.password,
    tenantCreationPasswordHash,
  );
  
  if (!passwordMatch) {
    // Log failed attempt
    this.logger.warn(
      `Failed tenant creation attempt from IP ${ip}`,
      { dto: { name: dto.name, slug: dto.slug } },
    );
    
    // Increment failed attempts counter
    const failKey = `tenant-creation-fail:${ip}`;
    const fails = await this.redis.incr(failKey);
    await this.redis.expire(failKey, 3600); // 1 hour
    
    // Block after 5 failed attempts
    if (fails >= 5) {
      throw new ForbiddenException('Too many failed attempts. Try again later.');
    }
    
    throw new BadRequestException('Invalid tenant creation password');
  }
  
  // Create tenant...
  const tenant = await this.prisma.tenant.create({
    data: {
      name: dto.name,
      slug: dto.slug,
      plan: dto.plan,
    },
  });
  
  // Audit log
  await this.auditLog.create({
    action: 'TENANT_CREATED',
    tenantId: tenant.id,
    userId: 'SYSTEM',
    ipAddress: ip,
    details: { name: dto.name, slug: dto.slug },
  });
  
  return tenant;
}
```

**Generate hashed password:**
```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('YOUR_SECURE_PASSWORD', 12, (e,h) => console.log(h))"
```

---

## 11. INPUT VALIDATION GAPS (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**Location:** Various DTOs  

### Issues Found:

#### A. OTP Request DTO - Weak Identifier Validation
```typescript
// otp-request.dto.ts
export class OtpRequestDto {
  @IsNotEmpty()
  @IsString()
  identifier: string; // Should validate email OR phone format
  
  @IsOptional()
  @IsIn(['AUTO', 'EMAIL', 'WHATSAPP'])
  channel?: string;
}
```

**Fix:**
```typescript
import { IsEmail, Matches, ValidateIf } from 'class-validator';

export class OtpRequestDto {
  @IsNotEmpty()
  @IsString()
  @ValidateIf(o => {
    // Validate as email if contains @
    if (o.identifier.includes('@')) {
      return IsEmail()(o, 'identifier');
    }
    // Validate as phone if starts with +
    if (o.identifier.startsWith('+')) {
      return Matches(/^\+[1-9]\d{1,14}$/)(o, 'identifier');
    }
    return false;
  })
  identifier: string;
  
  @IsOptional()
  @IsIn(['AUTO', 'EMAIL', 'WHATSAPP'])
  channel?: 'AUTO' | 'EMAIL' | 'WHATSAPP';
}
```

#### B. Invoice DTO - Missing Business Logic Validation
```typescript
// create-invoice.dto.ts
export class CreateInvoiceDto {
  @IsString()
  customerId: string;
  
  @IsArray()
  items: InvoiceItemDto[];
  
  // Missing: Total amount validation
  // Missing: Items array not empty
  // Missing: Date validations
}
```

**Fix:**
```typescript
export class CreateInvoiceDto {
  @IsUUID()
  customerId: string;
  
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
  
  @IsOptional()
  @IsDateString()
  issueDate?: string;
  
  @IsOptional()
  @IsDateString()
  @Validate(DueDateAfterIssueDateConstraint) // Custom validator
  dueDate?: string;
}
```

---

## 12. INFORMATION DISCLOSURE IN ERROR LOGS (MEDIUM)

**Severity:** 🟡 **MEDIUM**  
**File:** `src/common/filters/global-exception.filter.ts`  

### Issue:
Error logs may contain sensitive information:
```typescript
this.logger.error(
  `Error on ${request.method} ${request.url}`,
  exception.stack || '',
);
```

### Risks:
- Passwords in request body logged
- JWT tokens in Authorization header logged
- Database connection strings in stack traces
- User emails in error messages

### Fix:

```typescript
// global-exception.filter.ts
private sanitizeErrorForLogging(error: any, request: any): string {
  const original = error.toString();
  
  // Remove sensitive patterns
  let sanitized = original
    .replace(/password[=:]\s*[^\s&]+/gi, 'password=[REDACTED]')
    .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
    .replace(/secret[=:]\s*[^\s&]+/gi, 'secret=[REDACTED]')
    .replace(/api[_-]?key[=:]\s*[^\s&]+/gi, 'api_key=[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'bearer [REDACTED]')
    .replace(/\b[\w\.-]+@[\w\.-]+\.\w+\b/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD_REDACTED]');
  
  // Sanitize request data
  const sanitizedBody = this.sanitizeObject(request.body);
  
  return JSON.stringify({
    message: sanitized,
    method: request.method,
    url: request.url.replace(/token=[^&]+/, 'token=[REDACTED]'),
    body: sanitizedBody,
  });
}

private sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = { ...obj };
  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = this.sanitizeObject(sanitized[key]);
    }
  }
  
  return sanitized;
}
```

---

## 13-16. Additional Medium Issues (Summary)

### 13. Zustand localStorage Persistence (Medium - Frontend)
**Issue:** User PII stored in localStorage unencrypted  
**Fix:** Use sessionStorage or encrypt data

### 14. HTTPS Not Enforced (Medium - Frontend)
**Issue:** API URL can be HTTP in production  
**Fix:** Add validation in `getApiBaseUrl()`

### 15. No Helmet Details (Medium - Backend)
**Issue:** Default helmet config, could be stricter  
**Fix:** Configure CSP, HSTS, frame options explicitly

### 16. Missing Database Indexes (Medium - Backend)
**Issue:** Queries on company_id + status not indexed  
**Fix:** Add composite indexes

---

# 🟢 PART 4: LOW SEVERITY ISSUES

## 17-23. Low Severity Issues (Summary)

| Issue | Location | Fix |
|-------|----------|-----|
| Magic Link Token in URL | Frontend accept-invite | Use POST instead of GET |
| console.error in Production | Frontend invoice page | Remove or sanitize |
| Unused next-auth Package | Frontend deps | Remove unused package |
| .env Example in Repo | Backend .env | Create .env.example instead |
| No Logout Confirmation | Frontend auth | Add confirmation dialog |
| file-type Vulnerabilities | Both | Run npm audit fix |

---

# ✅ PART 5: SECURITY BEST PRACTICES IMPLEMENTED

## Backend - Excellent Practices:

1. ✅ **Password Hashing with bcrypt (12 rounds)**
   - Location: `src/modules/users/users.service.ts`
   
2. ✅ **Secure Cookie Configuration**
   - httpOnly: true
   - secure: true in production
   - sameSite: 'lax'
   
3. ✅ **JWT Token Strategy with Dual Sources**
   - Cookie + Authorization header
   - Proper expiration handling
   
4. ✅ **Role-Based Access Control (RBAC)**
   - RolesGuard
   - CompanyAccessGuard
   - Multi-level authorization
   
5. ✅ **SQL Injection Protection**
   - Prisma ORM with parameterized queries
   - No raw SQL concatenation
   
6. ✅ **Error Message Sanitization**
   - Technical errors hidden from users
   - Database errors mapped to generic messages
   
7. ✅ **Input Validation with class-validator**
   - DTO validation on all endpoints
   - ValidationPipe with whitelist enabled
   
8. ✅ **Rate Limiting (with caveat about IPv6)**
   - Auth endpoints protected
   - Redis-backed rate limiter
   
9. ✅ **Multi-Factor Authentication Support**
   - OTP via email/WhatsApp
   - Phone verification tracking
   
10. ✅ **Secure Password Reset Flow**
    - Time-limited tokens (30 min)
    - SHA256 token hashing
    - Single-use tokens

## Frontend - Good Practices:

1. ✅ **httpOnly Cookie Storage**
   - Tokens NOT in localStorage
   - Protected from XSS
   
2. ✅ **Automatic Token Refresh**
   - 401 handling with retry
   
3. ✅ **No dangerouslySetInnerHTML**
   - XSS prevention
   
4. ✅ **Input Validation with Zod**
   - Client-side + server-side validation
   
5. ✅ **TypeScript Throughout**
   - Type safety

---

# 🏗️ PART 6: ARCHITECTURE ASSESSMENT

## Overall Architecture Rating: **8/10** ⭐⭐⭐⭐

### Architecture Pattern: ⭐⭐⭐⭐⭐ Excellent

**Backend: NestJS Modular Monolith**
- Clean module separation (auth, users, invoices, accounting, etc.)
- Dependency injection throughout
- Service layer pattern consistently applied

**Frontend: Next.js App Router**
- Route groups for organization: (auth), (dashboard), (superadmin)
- Server components + client components properly separated
- Shared components in `/components`

### Code Organization: ⭐⭐⭐⭐ Good (with caveats)

**Strengths:**
- Clear module boundaries
- Consistent naming conventions
- Proper TypeScript usage

**Issues:**
- **Large service files** (auth.service.ts: 1,872 lines)
- **Monolithic page components** (superadmin/page.tsx: 2,476 lines)
- **Repeated hook patterns** (15 similar custom hooks)

**Recommendation:** Split large files into smaller, focused modules

### Database Design: ⭐⭐⭐⭐⭐ Excellent

**Schema Structure:**
```
Tenant (Multi-tenancy root)
├── Company (Tenant-scoped businesses)
│   ├── Users (via UserCompanyAccess)
│   ├── Customers
│   ├── Items
│   ├── Invoices
│   │   └── InvoiceItems
│   ├── Payments
│   └── Accounts (Accounting)
│       └── LedgerEntries
└── Subscriptions
```

**Strengths:**
- ✅ Proper normalization
- ✅ Foreign key constraints
- ✅ Strategic indexes on frequently queried columns
- ✅ Prisma migrations managed properly
- ✅ Tenant isolation enforced

**Missing:**
- ❌ No soft deletes (deletedAt column)
- ❌ No audit trail table (create who/when, update who/when)
- ❌ No unique constraints on invoice numbers per company

### API Design: ⭐⭐⭐⭐⭐ Excellent

**RESTful Design:**
- Consistent endpoint naming
- Proper HTTP methods
- Pagination implemented (50 default, 500 max)
- Swagger documentation available

**Custom Headers:**
- `X-Company-Id` for multi-tenant scoping
- `X-Request-Id` for request tracing
- `X-Tenant-Id` for isolation

### Testing Strategy: ⭐⭐⭐ Adequate

**Backend:**
- ✅ 10 E2E test suites
- ✅ Critical flows covered (auth, invoice, payment)
- ❌ Missing unit tests for services
- ❌ No integration tests for middleware

**Frontend:**
- ❌ Only ~3% test coverage
- ❌ No component tests
- ❌ No integration tests

**Recommendation:** Increase frontend test coverage to 50%+

### Performance: ⭐⭐⭐ Good

**Backend:**
- ✅ Query optimization with Prisma `include/select`
- ✅ Pagination implemented
- ✅ Connection pooling configured
- ⚠️ Potential N+1 queries in some services

**Frontend:**
- ⚠️ Unknown bundle size (no analysis configured)
- ⚠️ Large dependencies (Recharts, TanStack Table, Radix UI)
- ⚠️ No code splitting
- ⚠️ 152 useState calls without useMemo/useCallback optimization

### Scalability: ⭐⭐⭐ Good

**Strengths:**
- Redis for caching and rate limiting
- Database connection pooling
- Stateless JWT authentication
- Multi-tenant architecture

**Concerns:**
- Circuit breaker (opossum) installed but unused
- No query result caching
- Synchronous invoice calculations (could be async)
- No distributed tracing

---

# 📋 PART 7: REMEDIATION ROADMAP

## Phase 1: IMMEDIATE (Week 1) 🚨

### Security Critical:
- [ ] **Day 1:** Rotate all exposed secrets (JWT, SendGrid, Admin password)
- [ ] **Day 1:** Remove .env from git history
- [ ] **Day 2:** Update npm packages: `npm audit fix --force`
- [ ] **Day 2:** Fix rate limiting IPv6 bypass
- [ ] **Day 3:** Set up AWS Secrets Manager or HashiCorp Vault
- [ ] **Day 4:** Implement file upload security enhancements
- [ ] **Day 5:** Add file type validation using magic numbers
- [ ] **Day 6-7:** Configure CSP headers (backend + frontend)

### Cost: High urgency, ~2-3 developer days

---

## Phase 2: URGENT (Week 2-3) 🔶

### Security High Priority:
- [ ] Implement CSRF protection (backend + frontend)
- [ ] Secure static file serving with authentication
- [ ] Add database SSL/TLS enforcement
- [ ] Enhance error logging sanitization
- [ ] Add pre-commit hooks for secret detection

### Architecture:
- [ ] Split large service files (auth.service.ts)
- [ ] Add error codes to API responses
- [ ] Set up bundle analysis for frontend
- [ ] Add missing database indexes

### Cost: ~1 week of development

---

## Phase 3: IMPORTANT (Week 4) 🟡

### Security:
- [ ] Implement soft deletes for audit trail
- [ ] Add comprehensive audit logging
- [ ] Set up error tracking (Sentry/LogRocket)
- [ ] Implement frontend error boundaries

### Architecture:
- [ ] Split monolithic frontend components
- [ ] Increase test coverage to 50%
- [ ] Implement code splitting
- [ ] Add React performance optimizations

### Cost: 1-2 weeks of development

---

## Phase 4: ENHANCEMENT (Month 2) 🟢

### Observability:
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Performance monitoring
- [ ] Analytics implementation

### Architecture:
- [ ] Feature flag system
- [ ] API versioning
- [ ] Circuit breaker implementation
- [ ] Query result caching

### Cost: 2-3 weeks of development

---

# ✅ PART 8: PRE-PRODUCTION CHECKLIST

## Security Checklist:

- [ ] All secrets rotated and stored in secrets management
- [ ] `.env` file removed from git history
- [ ] npm audit returns 0 vulnerabilities
- [ ] File upload validation with magic number checking
- [ ] CSRF protection implemented and tested
- [ ] CSP headers configured and tested
- [ ] Database connection uses SSL/TLS
- [ ] Logging filters sensitive data
- [ ] Rate limiting tested with IPv6 addresses
- [ ] Static files served with authentication
- [ ] All authentication tests passing
- [ ] Pre-commit hooks for secret detection
- [ ] Security headers verified with securityheaders.com
- [ ] OWASP Top 10 checklist completed
- [ ] Penetration testing completed

## Architecture Checklist:

- [ ] Large service files split into smaller modules
- [ ] Error codes added to all API responses
- [ ] Bundle analysis shows acceptable sizes
- [ ] Frontend test coverage ≥ 50%
- [ ] Database indexes on all frequently queried columns
- [ ] Soft deletes implemented
- [ ] Audit logging complete
- [ ] Error boundaries in place
- [ ] Performance monitoring configured
- [ ] Load testing completed
- [ ] Backup and recovery tested
- [ ] Monitoring and alerting configured

---

# 📊 PART 9: METRICS & KPIS

## Current State:

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Critical Vulnerabilities | 3 | 0 | 🔴 |
| High Vulnerabilities | 3 | 0 | 🔴 |
| Medium Vulnerabilities | 12 | <3 | 🟡 |
| npm Audit Issues | 8 | 0 | 🔴 |
| Backend Test Coverage | ~30% | >80% | 🟡 |
| Frontend Test Coverage | ~3% | >50% | 🔴 |
| Security Headers Score | Unknown | A+ | ⚪ |
| Bundle Size | Unknown | <500KB | ⚪ |
| API Response Time (p95) | Unknown | <500ms | ⚪ |

## Post-Remediation Targets:

| Metric | Target | Timeline |
|--------|--------|----------|
| Critical Vulnerabilities | 0 | Week 1 |
| npm Audit Clean | 0 issues | Week 1 |
| CSP Configured | Grade A | Week 2 |
| CSRF Protected | 100% endpoints | Week 3 |
| Backend Tests | >80% coverage | Month 2 |
| Frontend Tests | >50% coverage | Month 2 |
| Performance Score | >90 | Month 2 |

---

# 📚 PART 10: ADDITIONAL RESOURCES

## Security Resources:

- **OWASP Top 10 2021:** https://owasp.org/www-project-top-ten/
- **NestJS Security:** https://docs.nestjs.com/security
- **Next.js Security:** https://nextjs.org/docs/app/building-your-application/configuring/security
- **Prisma Security:** https://www.prisma.io/docs/concepts/components/prisma-client/security
- **npm Audit Guide:** https://docs.npmjs.com/cli/v10/commands/npm-audit
- **Content Security Policy:** https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- **OWASP Cheat Sheets:** https://cheatsheetseries.owasp.org/

## Architecture Resources:

- **NestJS Best Practices:** https://docs.nestjs.com/
- **Next.js Architecture:** https://nextjs.org/docs
- **PostgreSQL Performance:** https://www.postgresql.org/docs/current/performance-tips.html
- **Redis Best Practices:** https://redis.io/docs/manual/patterns/
- **Multi-Tenant SaaS Patterns:** https://aws.amazon.com/blogs/apn/saas-architecture-fundamentals/

## Tools:

- **Secrets Management:** AWS Secrets Manager, HashiCorp Vault, Azure Key Vault
- **Error Tracking:** Sentry, LogRocket, Rollbar
- **Security Scanning:** Snyk, WhiteSource, Checkmarx
- **Performance Monitoring:** DataDog, New Relic, Grafana
- **Bundle Analysis:** webpack-bundle-analyzer, @next/bundle-analyzer

---

# 🎯 CONCLUSION

TextileBill demonstrates **solid architectural foundations** with well-structured NestJS backend and modern Next.js frontend. The application has implemented many security best practices including bcrypt password hashing, httpOnly cookies, RBAC, and input validation.

However, **3 CRITICAL vulnerabilities** and **several high-severity issues** must be addressed before production deployment:

1. **Hardcoded secrets in .env** → IMMEDIATE rotation required
2. **npm vulnerabilities** → IMMEDIATE updates required
3. **Rate limiting bypass** → IMMEDIATE fix required
4. **File upload security** → HIGH priority fix
5. **Static file serving** → HIGH priority fix

**Recommendation:** **DO NOT deploy to production** until Phase 1 (Week 1) and Phase 2 (Week 2-3) remediation tasks are completed.

**Estimated Effort:** 3-4 weeks of focused security and architecture improvements to reach production-ready state.

**Post-Remediation Rating:** Expected to reach **8.5/10** security rating with all critical and high issues resolved.

---

**Report End**  
*For questions or clarification on any findings, please refer to specific file locations and line numbers provided in each section.*
