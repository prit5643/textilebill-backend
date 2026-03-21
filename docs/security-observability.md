# Security And Observability Hardening

This runbook documents the production controls added for auth abuse prevention and request-path observability.

## 1) Secret Exposure Controls

Implemented behavior:

- OTP values are never logged in backend logs.
- User and tenant creation APIs do not return temporary passwords.
- Tenant provisioning requires explicit `adminPassword` input.

Related code:

- `src/modules/auth/auth.service.ts`
- `src/modules/users/users.service.ts`
- `src/modules/admin/admin.service.ts`
- `src/modules/admin/dto/index.ts`

## 2) Auth Abuse Protection

Rate limiting is applied at bootstrap level for:

- `POST /<API_PREFIX>/auth/login`
- `POST /<API_PREFIX>/auth/forgot-password`
- `POST /<API_PREFIX>/auth/reset-password`

Config variables:

- `AUTH_LOGIN_RATE_LIMIT_MAX` (default: `10`)
- `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `AUTH_FORGOT_RATE_LIMIT_MAX` (default: `5`)
- `AUTH_FORGOT_RATE_LIMIT_WINDOW_MS` (default: `900000`)
- `AUTH_RESET_RATE_LIMIT_MAX` (default: `10`)
- `AUTH_RESET_RATE_LIMIT_WINDOW_MS` (default: `900000`)

Implementation:

- `src/modules/auth/auth-rate-limit.util.ts`
- `src/main.ts`

## 3) Request Observability

HTTP logging now captures:

- normalized request path
- resolved route template (when available)
- status code
- duration
- request id / company id / user id context

The response includes:

- `x-response-time-ms` header

Slow requests (`duration >= SLOW_REQUEST_MS`) are logged as warnings.

Config variables:

- `SLOW_REQUEST_MS` (default: `1500`)

Implementation:

- `src/common/interceptors/logging.interceptor.ts`

## 4) Swagger And Production Tooling

Swagger policy:

- enabled by default outside production
- disabled by default in production
- production override via `ENABLE_SWAGGER=true`

Implementation:

- `src/main.ts`
- `src/config/app.config.ts`

## 5) Validation Commands

Backend unit/integration:

```bash
npm test -- \
  src/common/utils/config-value.util.spec.ts \
  src/common/interceptors/logging.interceptor.spec.ts \
  src/modules/auth/auth-rate-limit.util.spec.ts \
  src/modules/auth/auth-rate-limit.integration.spec.ts \
  src/modules/auth/auth.service.spec.ts \
  src/modules/users/users.service.spec.ts \
  src/modules/admin/admin.service.spec.ts
```

Backend e2e smoke:

```bash
npm run test:e2e -- test/auth-rate-limit.e2e-spec.ts test/auth.e2e-spec.ts
```
