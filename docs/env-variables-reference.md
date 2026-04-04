# Environment Variables Reference

Last updated: `2026-03-30`

## Backend

### Application

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` or `production` |
| `PORT` | yes | backend port, usually `3001` |
| `API_PREFIX` | yes | usually `api` |
| `APP_URL` | yes | frontend origin used in links |
| `CORS_ORIGIN` | yes | allowed frontend origin |

### Database

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | runtime DB URL |
| `DATABASE_DIRECT_URL` | recommended | direct DB URL for migration/bootstrap |
| `DATABASE_ADMIN_URL` | optional | admin DB URL for `db:init` |

### Redis

| Variable | Required | Notes |
|---|---|---|
| `REDIS_HOST` | recommended | local Redis or managed Redis host |
| `REDIS_PORT` | recommended | usually `6379` |
| `REDIS_PASSWORD` | optional | required in secured environments |

### Security

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | access/session verification secret |
| `JWT_REFRESH_SECRET` | yes | refresh secret |
| `APP_SECRET_KEY` | yes | app encryption/signing secret |
| `TRUST_PROXY` | optional | enable when behind proxy/load balancer |

### Bootstrap

| Variable | Required | Notes |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | recommended | owner seed email |
| `BOOTSTRAP_ADMIN_NAME` | recommended | owner display name |
| `BOOTSTRAP_ADMIN_PASSWORD` | recommended | owner seed password |
| `BOOTSTRAP_TENANT_NAME` | optional | bootstrap tenant name |
| `BOOTSTRAP_TENANT_SLUG` | optional | bootstrap tenant slug |
| `BOOTSTRAP_COMPANY_NAME` | optional | bootstrap company name |
| `BOOTSTRAP_DEMO_TRANSACTION_DATA` | optional | enable demo transaction data |

### Mail

| Variable | Required | Notes |
|---|---|---|
| `MAIL_ENABLED` | recommended | enables mail workflows |
| `MAIL_FROM` | optional | fallback sender |
| `MAIL_RESEND_API_KEY` | recommended | Resend API key |
| `MAIL_RESEND_FROM` | recommended | verified sender |
| `MAIL_RESEND_REPLY_TO` | optional | reply-to address |
| `MAIL_ASYNC_QUEUE_ENABLED` | optional | async mail mode toggle |

### Rate limiting and runtime tuning

Use env values described in code/config for auth rate limits, slow-request thresholds, and runtime overrides as needed.

## Frontend

### Required

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | backend origin or `/api` target source for rewrites |
| `JWT_SECRET` | recommended | used by Next middleware for session-token verification |

## Recommended Local Values

Backend:

```env
NODE_ENV=development
PORT=3001
API_PREFIX=api
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/textilebill
DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5432/textilebill
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
JWT_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
APP_SECRET_KEY=<secret>
BOOTSTRAP_ADMIN_EMAIL=owner@example.com
BOOTSTRAP_ADMIN_NAME=System Owner
BOOTSTRAP_ADMIN_PASSWORD=ChangeMe@123
```

Frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
JWT_SECRET=<same-frontend-session-secret>
```
