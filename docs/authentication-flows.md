# Authentication Flows Documentation - TextileBill Application

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Flow 1: User Signup (Invitation-Based)](#flow-1-user-signup-invitation-based)
- [Flow 2: Login with Password](#flow-2-login-with-password)
- [Flow 3: Login with OTP](#flow-3-login-with-otp)
- [Additional Features](#additional-features)
- [Security Features](#security-features)
- [Technical Implementation](#technical-implementation)

---

## Overview

The TextileBill application implements a **secure, multi-tenant authentication system** with three primary authentication flows:

1. **Invitation-Based Signup** - Admin creates users and sends invite links
2. **Password-Based Login** - Traditional username/password authentication
3. **OTP-Based Login** - Passwordless login using One-Time Passwords

### Key Features
- ✅ **Multi-tenant architecture** - Each user belongs to a tenant organization
- ✅ **Contact verification** - Email/WhatsApp verification for security
- ✅ **Token-based sessions** - JWT access tokens + refresh tokens
- ✅ **Rate limiting** - Protection against brute force attacks
- ✅ **Secure cookies** - HttpOnly cookies for token storage
- ✅ **Password reset** - Multiple methods (OTP & secure links)

---

## Architecture

### Backend (NestJS)
- **Location**: `textilebill-backend/src/modules/auth/`
- **Main Components**:
  - `auth.controller.ts` - API endpoints
  - `auth.service.ts` - Business logic
  - `otp-delivery.service.ts` - OTP sending (Email/WhatsApp)
  - Database: PostgreSQL (Prisma ORM)
  - Cache: Redis (for OTP storage & rate limiting)

### Frontend (React)
- **Location**: `textilebill-frontend/src/lib/`
- **Main Components**:
  - `auth-session.ts` - Session management utilities

### Database Models
- `User` - User accounts with credentials
- `RefreshToken` - Session management
- `OtpChallenge` - OTP verification records
- `PasswordLifecycleToken` - Invite & password reset tokens
- `Tenant` - Multi-tenant organizations

---

## Flow 1: User Signup (Invitation-Based)

### Overview
Users **cannot self-register**. Only tenant admins can create user accounts by sending invite links.

### Step-by-Step Process

#### **Step 1: Admin Creates User Account**

**API Endpoint**: `POST /api/users`

**Request Body**:
```json
{
  "email": "newuser@example.com",
  "username": "newuser",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+919876543210",
  "role": "STAFF",
  "companyIds": ["company-id-1"]
}
```

**Backend Process** (`users.service.ts`):
```typescript
// 1. Validate tenant subscription limits
const activeSub = tenant.subscriptions[0];
if (tenant.users.length >= activeSub.plan.maxUsers) {
  throw new ForbiddenException('User limit reached');
}

// 2. Check for duplicate email/username
const existing = await prisma.user.findFirst({
  where: { OR: [{ email: dto.email }, { username: dto.username }] }
});

// 3. Generate secure random password (user will set their own)
const rawPassword = randomUUID() + randomUUID();
const passwordHash = await bcrypt.hash(rawPassword, 12);

// 4. Generate invite token (30-minute expiry)
const inviteToken = generatePasswordLifecycleToken(); // Secure random token
const inviteTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

// 5. Create user in database
const user = await prisma.user.create({
  data: {
    tenantId,
    email: dto.email,
    username,
    passwordHash,
    role: dto.role || 'STAFF',
    firstName: dto.firstName,
    lastName: dto.lastName,
    phone: dto.phone,
    inviteToken,
    inviteTokenExpiresAt
  }
});

// 6. Store token in PasswordLifecycleToken table
await prisma.passwordLifecycleToken.create({
  data: {
    userId: user.id,
    tokenHash: hashPasswordLifecycleToken(inviteToken),
    type: 'SETUP_PASSWORD',
    status: 'ACTIVE',
    expiresAt: inviteTokenExpiresAt,
    maxResends: 3
  }
});
```

**Email Sent**:
```
Subject: Welcome to TextileBill - Set Your Password

Hi John,

You've been invited to join TextileBill.

Setup Link: https://app.textilebill.com/accept-invite?token=abc123xyz

This link expires in 30 minutes.
```

---

#### **Step 2: User Clicks Invite Link**

User opens the link in their browser: `/accept-invite?token=abc123xyz`

**Frontend**:
1. Extracts token from URL
2. Validates token by calling backend
3. Shows password setup form

**API Endpoint**: `GET /api/auth/invite/validate?token=abc123xyz`

**Backend Process** (`auth.service.ts`):
```typescript
async validateInviteToken(token: string) {
  // 1. Find token record in database
  const tokenRecord = await prisma.passwordLifecycleToken.findFirst({
    where: {
      tokenHash: hashPasswordLifecycleToken(token),
      type: 'SETUP_PASSWORD',
      status: 'ACTIVE',
      expiresAt: { gt: new Date() } // Not expired
    },
    include: { user: true }
  });

  if (!tokenRecord) {
    throw new BadRequestException('Invalid or expired invite link');
  }

  // 2. Return user details for form
  return {
    valid: true,
    email: tokenRecord.user.email,
    firstName: tokenRecord.user.firstName,
    expiresAt: tokenRecord.expiresAt
  };
}
```

**Response**:
```json
{
  "valid": true,
  "email": "newuser@example.com",
  "firstName": "John",
  "expiresAt": "2026-03-19T10:30:00Z",
  "status": "PENDING_SETUP"
}
```

---

#### **Step 3: User Sets Password**

User fills password setup form and submits.

**API Endpoint**: `POST /api/auth/accept-invite`

**Request Body**:
```json
{
  "token": "abc123xyz",
  "newPassword": "SecurePassword123!"
}
```

**Backend Process** (`auth.service.ts`):
```typescript
async acceptInvite(token: string, newPassword: string) {
  // 1. Validate token again
  const tokenRecord = await findActivePasswordTokenByRawToken(token, 'SETUP_PASSWORD');
  
  if (!tokenRecord) {
    throw new BadRequestException('Invalid or expired token');
  }

  // 2. Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // 3. Update user in database
  await prisma.user.update({
    where: { id: tokenRecord.userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(), // Mark as password set
      inviteToken: null,
      inviteTokenExpiresAt: null
    }
  });

  // 4. Mark token as used
  await prisma.passwordLifecycleToken.update({
    where: { id: tokenRecord.id },
    data: { status: 'USED' }
  });

  // 5. Auto-login: Generate JWT tokens
  const user = await prisma.user.findUnique({ where: { id: tokenRecord.userId } });
  const tokens = await this.generateTokens(user);

  // 6. Return session with tokens
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionToken: tokens.sessionToken,
    user: { /* user details */ }
  };
}
```

**Response** (Auto-login):
```json
{
  "user": {
    "id": "user-123",
    "email": "newuser@example.com",
    "username": "newuser",
    "role": "STAFF",
    "firstName": "John",
    "lastName": "Doe",
    "mustChangePassword": false,
    "emailVerified": false,
    "phoneVerified": false
  },
  "companies": [
    { "id": "comp-1", "name": "ABC Textiles" }
  ]
}
```

**Cookies Set** (HttpOnly, Secure):
```
access_token=eyJhbGc...  (15 minutes expiry)
refresh_token=uuid...   (30 days expiry)
session_token=uuid...   (30 days expiry)
```

✅ **User is now registered and logged in!**

---

## Flow 2: Login with Password

### Overview
Traditional authentication using username/email and password.

### Step-by-Step Process

#### **Step 1: User Enters Credentials**

**API Endpoint**: `POST /api/auth/login`

**Request Body**:
```json
{
  "username": "newuser",
  "password": "SecurePassword123!"
}
```

**Backend Process** (`auth.service.ts`):
```typescript
async login(dto: LoginDto, metadata?: SessionClientMetadata) {
  // 1. Find user by username or email
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: dto.username },
        { email: dto.username }
      ],
      isActive: true
    },
    include: { tenant: true }
  });

  if (!user) {
    throw new UnauthorizedException('Invalid credentials');
  }

  // 2. Verify password
  const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
  
  if (!isPasswordValid) {
    throw new UnauthorizedException('Invalid credentials');
  }

  // 3. Check contact verification
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
    throw new ForbiddenException(
      'Account is not verified. Sign in with OTP first to verify contact details.'
    );
  }

  // 4. Generate JWT tokens
  const tokens = await this.generateTokens(user, metadata);

  // 5. Update last login timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  // 6. Build session payload
  const session = await this.buildAuthSessionPayload(user.id);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionToken: tokens.sessionToken,
    ...session
  };
}
```

**Token Generation** (`generateTokens`):
```typescript
async generateTokens(user, metadata?) {
  const sessionId = randomUUID();
  
  // 1. Create JWT access token (15 minutes)
  const payload: JwtPayload = {
    sub: user.id,
    sessionId: sessionId,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId
  };
  
  const accessToken = this.jwtService.sign(payload, {
    expiresIn: '15m'
  });

  // 2. Create refresh token (30 days)
  const refreshToken = randomUUID();
  const refreshTokenHash = this.hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // 3. Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      tokenHash: refreshTokenHash,
      sessionId: sessionId,
      expiresAt: expiresAt,
      deviceId: metadata?.deviceId,
      userAgent: metadata?.userAgent,
      ipAddress: metadata?.ipAddress
    }
  });

  return {
    accessToken,
    refreshToken,
    sessionToken: sessionId
  };
}
```

**Response**:
```json
{
  "user": {
    "id": "user-123",
    "email": "newuser@example.com",
    "username": "newuser",
    "role": "STAFF",
    "firstName": "John",
    "lastName": "Doe",
    "emailVerified": true,
    "phoneVerified": false,
    "hasVerifiedContact": true
  },
  "companies": [
    { "id": "comp-1", "name": "ABC Textiles" }
  ]
}
```

**Cookies Set**:
```
access_token=eyJhbGc...  (HttpOnly, Secure, 15 min)
refresh_token=uuid...   (HttpOnly, Secure, 30 days)
session_token=uuid...   (HttpOnly, Secure, 30 days)
```

✅ **User is logged in!**

---

## Flow 3: Login with OTP

### Overview
Passwordless authentication using One-Time Passwords sent via Email or WhatsApp.

### Step-by-Step Process

#### **Step 1: User Requests OTP**

**API Endpoint**: `POST /api/auth/otp/request`

**Request Body**:
```json
{
  "identifier": "newuser@example.com",
  "channel": "AUTO"
}
```

**Channel Options**:
- `AUTO` - System chooses best available (Email → WhatsApp fallback)
- `EMAIL` - Force email delivery
- `WHATSAPP` - Force WhatsApp delivery

**Backend Process** (`auth.service.ts`):
```typescript
async requestLoginOtp(identifier: string, preferredChannel: 'AUTO' | 'EMAIL' | 'WHATSAPP') {
  // 1. Check Redis availability
  if (!redisService.isAvailable()) {
    throw new ServiceUnavailableException('OTP service temporarily unavailable');
  }

  // 2. Find user by identifier (username, email, or phone)
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: identifier },
        { email: identifier },
        { phone: identifier }
      ],
      isActive: true
    }
  });

  if (!user) {
    // Security: Don't reveal if user exists
    return {
      message: 'If the account exists, an OTP has been sent.',
      requestId: null
    };
  }

  // 3. Determine delivery channel
  const primary = this.resolvePrimaryOtpRoute(user, preferredChannel);
  // Returns: { channel: 'EMAIL', target: 'user@example.com', fallbackChannel: 'WHATSAPP', fallbackTarget: '+919876543210' }

  // 4. Generate OTP code
  const otp = this.generateOtpCode(); // 6-digit number

  // 5. Create OTP challenge
  const requestId = randomUUID();
  const challenge = {
    requestId,
    userId: user.id,
    otp: otp,
    purpose: 'LOGIN',
    channel: primary.channel,
    target: primary.target,
    resendCount: 0,
    fallbackChannel: primary.fallbackChannel,
    fallbackTarget: primary.fallbackTarget
  };

  // 6. Store in Redis (5 minutes TTL)
  await redisService.set(
    `otp:${requestId}`,
    JSON.stringify(challenge),
    300 // 5 minutes
  );

  // 7. Store in database for audit
  await prisma.otpChallenge.create({
    data: {
      id: requestId,
      userId: user.id,
      purpose: 'LOGIN',
      deliveredChannel: primary.channel,
      targetIdentifier: primary.target,
      expiresAt: new Date(Date.now() + 300 * 1000)
    }
  });

  // 8. Send OTP
  if (primary.channel === 'EMAIL') {
    await otpDeliveryService.sendEmailOtp(primary.target, otp);
  } else {
    await otpDeliveryService.sendWhatsAppOtp(primary.target, otp);
  }

  return {
    message: 'OTP sent successfully.',
    requestId: requestId,
    channel: primary.channel,
    targetHint: '****@example.com', // Masked
    expiresInSeconds: 300,
    resendCooldownSeconds: 32
  };
}
```

**Response**:
```json
{
  "message": "OTP sent successfully.",
  "requestId": "req-uuid-123",
  "channel": "EMAIL",
  "targetHint": "new****@example.com",
  "expiresInSeconds": 300,
  "resendCooldownSeconds": 32
}
```

**Email/WhatsApp Sent**:
```
Your TextileBill login code: 123456

This code expires in 5 minutes.
```

---

#### **Step 2: User Enters OTP**

**API Endpoint**: `POST /api/auth/otp/verify`

**Request Body**:
```json
{
  "requestId": "req-uuid-123",
  "otp": "123456"
}
```

**Backend Process** (`auth.service.ts`):
```typescript
async verifyLoginOtp(requestId: string, otp: string) {
  // 1. Retrieve OTP challenge from Redis
  const challengeData = await redisService.get(`otp:${requestId}`);
  
  if (!challengeData) {
    throw new UnauthorizedException('Invalid or expired OTP request');
  }

  const challenge = JSON.parse(challengeData);

  // 2. Verify purpose
  if (challenge.purpose !== 'LOGIN') {
    throw new UnauthorizedException('Invalid OTP purpose');
  }

  // 3. Verify OTP code
  if (challenge.otp !== otp.trim()) {
    throw new UnauthorizedException('Invalid or expired OTP');
  }

  // 4. Get user details
  const user = await prisma.user.findUnique({
    where: { id: challenge.userId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      tenantId: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      isActive: true
    }
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedException('Invalid user');
  }

  // 5. Mark contact as verified (if not already)
  const verifyPatch = challenge.channel === 'EMAIL'
    ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
    : { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...verifyPatch,
      lastLoginAt: new Date()
    }
  });

  // 6. Mark OTP as verified in database
  await prisma.otpChallenge.update({
    where: { id: requestId },
    data: { verifiedAt: new Date() }
  });

  // 7. Delete OTP from Redis
  await redisService.del(`otp:${requestId}`);
  await redisService.del(`otp:cooldown:${requestId}`);

  // 8. Generate JWT tokens
  const tokens = await this.generateTokens(user);
  const session = await this.buildAuthSessionPayload(user.id);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionToken: tokens.sessionToken,
    ...session
  };
}
```

**Response** (Same as password login):
```json
{
  "user": {
    "id": "user-123",
    "email": "newuser@example.com",
    "username": "newuser",
    "role": "STAFF",
    "emailVerified": true,
    "phoneVerified": false,
    "hasVerifiedContact": true
  },
  "companies": [...]
}
```

**Cookies Set**:
```
access_token=eyJhbGc...
refresh_token=uuid...
session_token=uuid...
```

✅ **User is logged in via OTP!**

---

#### **Optional: Resend OTP**

If user doesn't receive OTP, they can request resend (with cooldown).

**API Endpoint**: `POST /api/auth/otp/resend`

**Request Body**:
```json
{
  "requestId": "req-uuid-123"
}
```

**Backend Process**:
```typescript
async resendOtp(requestId: string) {
  // 1. Get challenge from Redis
  const challenge = await this.getOtpChallenge(requestId);
  
  // 2. Check cooldown (32 seconds)
  const cooldownKey = `otp:cooldown:${requestId}`;
  const inCooldown = await redisService.get(cooldownKey);
  
  if (inCooldown) {
    const retryAfterSeconds = await redisService.getTtlSeconds(cooldownKey);
    throw new HttpException('Please wait before requesting another OTP', 429);
  }

  // 3. Check resend limit (max 3 times)
  if (challenge.resendCount >= 3) {
    throw new HttpException('OTP resend limit reached', 429);
  }

  // 4. Generate new OTP
  challenge.otp = this.generateOtpCode();
  challenge.resendCount += 1;

  // 5. Update Redis
  await this.storeOtpChallenge(challenge);

  // 6. Send OTP again
  await this.dispatchOtp(challenge);

  // 7. Set cooldown
  await redisService.set(cooldownKey, '1', 32);

  return {
    message: 'OTP resent successfully.',
    resendCount: challenge.resendCount
  };
}
```

---

## Additional Features

### 1. Token Refresh

When access token expires (15 minutes), use refresh token to get new tokens.

**API Endpoint**: `POST /api/auth/refresh`

**Request**: Refresh token from cookie (automatic)

**Process**:
```typescript
async refreshTokens(refreshToken: string) {
  // 1. Validate refresh token
  const storedToken = await prisma.refreshToken.findFirst({
    where: {
      tokenHash: this.hashRefreshToken(refreshToken),
      revokedAt: null,
      expiresAt: { gt: new Date() }
    }
  });

  if (!storedToken) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  // 2. Generate new tokens
  const newTokens = await this.generateTokens(storedToken.user);

  // 3. Revoke old refresh token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() }
  });

  return newTokens;
}
```

---

### 2. Logout

**API Endpoint**: `POST /api/auth/logout`

**Process**:
```typescript
async logout(refreshToken: string) {
  // 1. Revoke refresh token
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revokedAt: new Date() }
  });

  // 2. Clear from Redis cache
  await redisService.del(`refresh:${refreshToken}`);

  // 3. Clear cookies (done by controller)
  return { message: 'Logged out successfully' };
}
```

---

### 3. Password Reset (Forgot Password)

**Two Methods**:

#### **Method A: OTP-Based Reset**

1. `POST /api/auth/forgot-password` - Request OTP
2. `POST /api/auth/reset-password` - Submit OTP + new password

#### **Method B: Secure Link Reset**

1. `POST /api/auth/password-reset/request` - Request reset link (sent via email)
2. `GET /api/auth/password-reset/validate?token=xyz` - Validate link
3. `POST /api/auth/password-reset/complete` - Submit new password

---

### 4. Contact Verification

After first login, users can verify email/WhatsApp:

**API Endpoints**:
- `GET /api/auth/verification-status` - Check verification status
- `POST /api/auth/verify-contact/request` - Request verification OTP
- `POST /api/auth/verify-contact/confirm` - Verify OTP

---

## Security Features

### 1. **Password Security**
- Passwords hashed with bcrypt (12 rounds)
- Minimum complexity enforced (frontend validation)
- Password history tracked (`passwordChangedAt`)

### 2. **Token Security**
- JWT access tokens (short-lived: 15 min)
- Refresh tokens (long-lived: 30 days)
- Tokens stored in **HttpOnly, Secure cookies**
- Refresh token rotation on refresh
- All tokens revoked on password change

### 3. **OTP Security**
- 6-digit random codes
- 5-minute expiry
- Stored in Redis (encrypted)
- Rate limiting: 3 resends max, 32-second cooldown
- OTP verified once, then deleted

### 4. **Rate Limiting**
- Login attempts limited per IP
- OTP requests limited per user
- Implemented via Redis + custom middleware

### 5. **Multi-Tenant Isolation**
- Every user belongs to a tenant
- JWT includes `tenantId`
- Database queries filtered by tenant
- Guards enforce tenant boundaries

### 6. **Session Management**
- Multiple active sessions supported
- Device tracking (IP, User-Agent, Device ID)
- `GET /api/auth/sessions` - List active sessions
- `DELETE /api/auth/sessions/:tokenId` - Revoke session

### 7. **CORS & Origin Validation**
- `assertAllowedOrigin()` checks request origin
- Only configured domains allowed
- Prevents CSRF attacks

---

## Technical Implementation

### JWT Payload Structure
```typescript
{
  "sub": "user-123",         // User ID
  "sessionId": "session-456", // Session identifier
  "email": "user@example.com",
  "role": "STAFF",
  "tenantId": "tenant-789",
  "iat": 1710838800,         // Issued at
  "exp": 1710839700          // Expires at
}
```

### Refresh Token Database Schema
```prisma
model RefreshToken {
  id          String    @id @default(uuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  token       String    @unique
  tokenHash   String    @unique
  sessionId   String
  expiresAt   DateTime
  revokedAt   DateTime?
  deviceId    String?
  userAgent   String?
  ipAddress   String?
  createdAt   DateTime  @default(now())
}
```

### OTP Challenge Database Schema
```prisma
model OtpChallenge {
  id                String    @id @default(uuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id])
  purpose           String    // LOGIN, VERIFY_EMAIL, etc.
  deliveredChannel  String    // EMAIL, WHATSAPP
  targetIdentifier  String    // email or phone
  resendCount       Int       @default(0)
  verifiedAt        DateTime?
  expiresAt         DateTime
  createdAt         DateTime  @default(now())
  lastSentAt        DateTime  @default(now())
}
```

### Password Lifecycle Token Schema
```prisma
model PasswordLifecycleToken {
  id               String              @id @default(uuid())
  tenantId         String
  userId           String
  user             User                @relation(fields: [userId], references: [id])
  tokenHash        String              @unique
  type             PasswordTokenType   // SETUP_PASSWORD, RESET_PASSWORD
  status           PasswordTokenStatus // ACTIVE, USED, REVOKED, EXPIRED
  expiresAt        DateTime
  maxResends       Int                 @default(3)
  resendCount      Int                 @default(0)
  requestedByRole  String?
  createdAt        DateTime            @default(now())
}
```

### Environment Variables
```env
# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m

# Refresh Token
REFRESH_TOKEN_LIFETIME_DAYS=30

# Application URL
APP_URL=https://app.textilebill.com

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Email Service
MAIL_ENABLED=true
MAIL_FROM=TextileBill <onboarding@resend.dev>
MAIL_RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
MAIL_RESEND_FROM=TextileBill <billing@yourdomain.com>
MAIL_RESEND_REPLY_TO=support@yourdomain.com

# WhatsApp API
WHATSAPP_API_URL=https://api.whatsapp.com
WHATSAPP_API_KEY=your-api-key
```

---

## Summary

### Signup Flow
1. Admin creates user → Invite email sent
2. User clicks link → Sets password
3. Auto-login with JWT tokens

### Password Login Flow
1. User enters username/password
2. Backend validates credentials
3. Contact verification checked
4. JWT tokens generated → Cookies set

### OTP Login Flow
1. User requests OTP (email/WhatsApp)
2. OTP stored in Redis (5 min)
3. User enters OTP
4. Backend verifies → Auto-verify contact
5. JWT tokens generated → Cookies set

All flows result in:
- ✅ Access token (15 min)
- ✅ Refresh token (30 days)
- ✅ Session stored in database
- ✅ User authenticated

---

## API Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/login` | POST | Password login |
| `/auth/otp/request` | POST | Request OTP |
| `/auth/otp/verify` | POST | Verify OTP & login |
| `/auth/otp/resend` | POST | Resend OTP |
| `/auth/refresh` | POST | Refresh tokens |
| `/auth/logout` | POST | Logout |
| `/auth/me` | GET | Get current user |
| `/auth/accept-invite` | POST | Set password (signup) |
| `/auth/invite/validate` | GET | Validate invite link |
| `/auth/change-password` | POST | Change password |
| `/auth/forgot-password` | POST | Request password reset OTP |
| `/auth/reset-password` | POST | Reset password with OTP |
| `/auth/password-reset/request` | POST | Request reset link |
| `/auth/password-reset/complete` | POST | Reset with link |
| `/auth/sessions` | GET | List active sessions |
| `/auth/sessions/:id` | DELETE | Revoke session |

---

**Generated for**: TextileBill Application  
**Last Updated**: 2026-03-19  
**Backend**: NestJS + Prisma + PostgreSQL + Redis  
**Frontend**: React  
