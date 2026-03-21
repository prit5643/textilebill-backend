# 🔐 Environment Variables Quick Reference

## Summary of All Environment Variables

| Variable | Local Dev | Production | Where to Get | Required |
|----------|-----------|------------|--------------|----------|
| **Application** |
| `NODE_ENV` | `development` | `production` | Set manually | ✅ Yes |
| `PORT` | `3001` | `3001` | Set manually | ✅ Yes |
| `API_PREFIX` | `api` | `api` | Set manually | ✅ Yes |
| `CORS_ORIGIN` | `http://localhost:3000` | `https://your-frontend.vercel.app` | Your Vercel URL | ✅ Yes |
| **Database** |
| `DATABASE_URL` | Direct (5432) | Pooled (6543) | Supabase Dashboard | ✅ Yes |
| **Redis** |
| `REDIS_HOST` | `localhost` | `your-host.upstash.io` | Upstash/Render | ✅ Yes |
| `REDIS_PORT` | `6379` | `6379` | Upstash/Render | ✅ Yes |
| `REDIS_PASSWORD` | (empty) | Your password | Upstash/Render | ⚠️ Prod only |
| **JWT** |
| `JWT_SECRET` | Dev secret | Strong secret | `openssl rand -base64 32` | ✅ Yes |
| `JWT_EXPIRES_IN` | `15m` | `15m` | Set manually | ✅ Yes |
| `JWT_REFRESH_SECRET` | Dev secret | Strong secret | `openssl rand -base64 32` | ✅ Yes |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | `7d` | Set manually | ✅ Yes |
| `ADMIN_TENANT_CREATION_PASSWORD` | Dev password | Strong password | Generate secure password | ✅ Yes |
| **Email (Gmail via Nodemailer)** |
| `MAIL_ENABLED` | `true` | `true` | Set manually | ✅ Yes |
| `MAIL_TRANSPORT` | `gmail` | `gmail` | Set to `gmail` | ✅ Yes |
| `MAIL_FROM` | Your Gmail | Your Gmail | Gmail account | ✅ Yes |
| `MAIL_GMAIL_USER` | Your Gmail | Your Gmail | Gmail account | ✅ Yes |
| `MAIL_GMAIL_APP_PASSWORD` | App password | App password | [Google App Passwords](https://myaccount.google.com/apppasswords) | ✅ Yes |
| `MAIL_GMAIL_FROM` | Your Gmail | Your Gmail | Gmail account | ✅ Yes |
| `MAIL_ASYNC_QUEUE_ENABLED` | `false` | `false` | Set manually | ❌ No |
| `MAIL_TEST_TO` | Test email | (empty) | Optional | ❌ No |
| **AWS S3** |
| `AWS_REGION` | `ap-south-1` | `ap-south-1` | AWS Console | ⚠️ If using S3 |
| `AWS_ACCESS_KEY_ID` | Your key | Your key | AWS IAM | ⚠️ If using S3 |
| `AWS_SECRET_ACCESS_KEY` | Your secret | Your secret | AWS IAM | ⚠️ If using S3 |
| `AWS_S3_BUCKET` | `textilebill-uploads-dev` | `textilebill-uploads-prod` | AWS S3 | ⚠️ If using S3 |
| **Rate Limiting** |
| `THROTTLE_TTL` | `60` | `60` | Set manually | ✅ Yes |
| `THROTTLE_LIMIT` | `60` | `60` | Set manually | ✅ Yes |

---

## Connection String Formats

### Supabase Database

**Local Development (Direct - Port 5432):**
```bash
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**Production Runtime (Pooled - Port 6543):**
```bash
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**For Migrations (Direct - Port 5432):**
```bash
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

### Redis

**Upstash:**
```bash
HOST: your-redis-host.upstash.io
PORT: 6379
PASSWORD: your-upstash-password
```

**Render Redis:**
```bash
HOST: red-xxxxx.upstash.io
PORT: 6379
PASSWORD: your-render-redis-password
```

---

## How to Get Each Credential

### Supabase
1. Go to https://supabase.com/dashboard
2. Select your project
3. Settings → Database
4. Scroll to "Connection string"
5. Copy URI and replace `[YOUR-PASSWORD]`

### Gmail App Password
1. Go to https://myaccount.google.com/apppasswords
2. Sign in to your Google Account
3. Create a new App Password
4. Select "Mail" and your device
5. Copy the 16-character password (remove spaces)

**Note:** You must have 2-Step Verification enabled on your Google Account to create App Passwords.

### Upstash Redis
1. Go to https://console.upstash.com/
2. Create new database
3. Copy connection details from dashboard

### AWS S3
1. Go to https://console.aws.amazon.com/
2. IAM → Users → Create User
3. Attach policy: `AmazonS3FullAccess`
4. Security Credentials → Create Access Key
5. Copy Access Key ID and Secret

### JWT Secrets
```bash
# Generate two different secrets
openssl rand -base64 32
openssl rand -base64 32
```

---

## Environment Files Locations

```
project/
├── backend/
│   ├── .env                          # Local development (Git ignored)
│   ├── .env.production.template      # Template for production
│   └── .env.supabase.template        # Supabase connection examples
├── frontend/
│   ├── .env.local                    # Local development (Git ignored)
│   └── .env.production.template      # Template for production
└── .gitignore                        # Ensure .env files are ignored
```

---

## Copy-Paste Templates

### Backend Local Development (.env)

```bash
NODE_ENV=development
PORT=3001
API_PREFIX=api
CORS_ORIGIN=http://localhost:3000

# Local PostgreSQL
DATABASE_URL=postgresql://jenishkheni@localhost:5432/textilebill

# OR Supabase (uncomment to use)
# DATABASE_URL=postgresql://postgres.xxxxx:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_SECRET=dev-jwt-secret-change-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
JWT_REFRESH_EXPIRES_IN=7d
ADMIN_TENANT_CREATION_PASSWORD=dev-admin-password

AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=textilebill-uploads-dev

MAIL_ENABLED=true
MAIL_TRANSPORT=gmail
MAIL_FROM=your-email@gmail.com
MAIL_GMAIL_USER=your-email@gmail.com
MAIL_GMAIL_APP_PASSWORD=your-16-char-app-password
MAIL_GMAIL_FROM=your-email@gmail.com
MAIL_ASYNC_QUEUE_ENABLED=false

THROTTLE_TTL=60
THROTTLE_LIMIT=60
```

### Backend Production (Render Environment Variables)

```bash
NODE_ENV=production
PORT=3001
API_PREFIX=api
CORS_ORIGIN=https://your-frontend.vercel.app

DATABASE_URL=postgresql://postgres.xxxxx:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1

REDIS_HOST=your-redis-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

JWT_SECRET=PRODUCTION_SECRET_32_CHARS_MIN
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=DIFFERENT_PRODUCTION_SECRET_32_CHARS_MIN
JWT_REFRESH_EXPIRES_IN=7d
ADMIN_TENANT_CREATION_PASSWORD=secure-admin-password

AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=YOUR_AWS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET
AWS_S3_BUCKET=textilebill-uploads-prod

MAIL_ENABLED=true
MAIL_TRANSPORT=gmail
MAIL_FROM=your-email@gmail.com
MAIL_GMAIL_USER=your-email@gmail.com
MAIL_GMAIL_APP_PASSWORD=your-16-char-app-password
MAIL_GMAIL_FROM=your-email@gmail.com
MAIL_ASYNC_QUEUE_ENABLED=false

THROTTLE_TTL=60
THROTTLE_LIMIT=60
```

### Frontend Local Development (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Frontend Production (Vercel Environment Variables)

```bash
NEXT_PUBLIC_API_URL=https://textilebill-backend.onrender.com
```

---

## Security Best Practices

### ✅ DO:
- Use different secrets for dev/staging/production
- Generate strong random secrets (`openssl rand -base64 32`)
- Store secrets in password manager
- Use environment variables, never hardcode
- Rotate secrets periodically (quarterly)
- Use `.gitignore` for all `.env` files

### ❌ DON'T:
- Commit `.env` files to Git
- Share secrets in plain text (email, chat)
- Use same password for different services
- Use weak or predictable secrets
- Expose secrets in frontend code (except NEXT_PUBLIC_*)
- Store secrets in frontend localStorage

---

## Verification Commands

### Test Database Connection
```bash
# Local
psql "$DATABASE_URL"

# Or using Prisma
npx prisma db pull
```

### Test Redis Connection
```bash
# Using redis-cli
redis-cli -h your-host -p 6379 -a your-password ping
# Should return: PONG
```

### Generate Secrets
```bash
# JWT Secret
openssl rand -base64 32

# Multiple secrets at once
for i in {1..3}; do openssl rand -base64 32; done
```

### Test Gmail SMTP
```bash
# Test email delivery from backend
cd backend
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
  }
});
transporter.sendMail({
  from: 'your-email@gmail.com',
  to: 'test@example.com',
  subject: 'Test Email via Gmail',
  text: 'This is a test from Gmail SMTP using nodemailer'
}).then(info => {
  console.log('✅ Email sent:', info.messageId);
}).catch(err => {
  console.error('❌ Failed:', err.message);
});
"
```

---

## Troubleshooting Environment Variables

### Backend won't start
1. Check all required variables are set
2. Verify DATABASE_URL format
3. Check for typos in variable names
4. Ensure no trailing spaces in values

### Database connection fails
1. Verify password has no special characters
2. Use correct port (5432 dev, 6543 prod)
3. Check pgbouncer parameter (prod only)
4. Verify Supabase project is active

### CORS errors
1. Verify CORS_ORIGIN matches frontend URL exactly
2. No trailing slash in URL
3. Include protocol (https://)
4. Restart backend after changing

### Frontend can't reach backend
1. Verify NEXT_PUBLIC_API_URL is correct
2. No trailing slash
3. Rebuild frontend after changing env vars
4. Check browser console for actual URL being used

---

## Migration Guide

### Switching from Local PostgreSQL to Supabase

1. **Get Supabase connection string**
2. **Update backend/.env:**
   ```bash
   # Comment out local
   # DATABASE_URL=postgresql://localhost:5432/textilebill
   
   # Add Supabase
   DATABASE_URL=postgresql://postgres.xxxxx:pwd@host:5432/postgres
   ```
3. **Run migrations:**
   ```bash
   npx prisma migrate deploy
   ```
4. **Verify in Supabase dashboard**

### Updating Production Environment

1. **Render Dashboard:**
   - Your Service → Environment
   - Edit variable
   - Click "Save Changes"
   - Service auto-redeploys

2. **Vercel Dashboard:**
   - Your Project → Settings → Environment Variables
   - Edit or add variable
   - Select environment (Production)
   - Redeploy from Deployments tab

---

**Last Updated:** 2026-03-20
**For Deployment Guide:** See `deployment.md`
**For Supabase Setup:** See `SUPABASE_SETUP.md`
**For Checklist:** See `DEPLOYMENT_CHECKLIST.md`
