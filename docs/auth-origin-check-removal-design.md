# Auth Origin Check Removal Design

## Summary

Remove backend request-origin enforcement from cookie-mutating authentication routes so login and related auth flows work regardless of browser `Origin` header.

This change is driven by the current failure where the local frontend at `http://localhost:3000` sends auth requests to the hosted backend and receives `403 Forbidden` with the message `Invalid request origin` before authentication logic runs.

## Problem

The backend currently calls `assertAllowedOrigin()` before processing several auth routes. In production, that guard compares the incoming `Origin` header against `APP_URL` and rejects any non-matching browser origin.

That behavior blocks valid local development against the hosted backend because:

- the frontend proxies `/api/*` requests to the configured backend origin
- the browser still sends `Origin: http://localhost:3000`
- the hosted backend is configured with `APP_URL` values that do not include `http://localhost:3000`
- the request fails before login, refresh, OTP, or password-reset logic can run

## Goal

Make browser auth flows fully work without any origin requirement.

## Non-Goals

- Do not redesign cookie handling
- Do not change login credentials, session payloads, or auth token lifetimes
- Do not change rate limiting or account/role authorization behavior
- Do not introduce a replacement origin allowlist or a config flag in this change

## Current Behavior

The following backend auth routes currently enforce request-origin validation before continuing:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/otp/resend`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/complete`
- `POST /api/auth/reset-password`
- invite/password setup flows that mutate auth cookies

If the backend runs in production mode and the browser `Origin` header is not present in the normalized `APP_URL` list, the backend throws `ForbiddenException('Invalid request origin')`.

## Proposed Design

### Architecture

Remove effective origin validation from the auth controller flow.

The auth controller will continue to:

- receive the request
- call the auth service
- set or clear cookies
- return the existing response payloads

The request will no longer be stopped by origin validation before auth processing begins.

### Code Boundaries

Primary files expected to change:

- `textilebill-backend/src/modules/auth/auth-cookie.util.ts`
- related auth tests under `textilebill-backend/src/modules/auth/*.spec.ts`

The preferred implementation is to remove the effective enforcement in `auth-cookie.util.ts` first, because that keeps controller flow unchanged and minimizes churn across every auth route that already calls the helper.

`auth.controller.ts` should only change if removing the helper entirely proves cleaner than keeping a compatibility wrapper.

### Data Flow

New request flow:

1. Browser sends `POST /api/auth/login` or another auth request.
2. Backend controller accepts the request without checking `Origin`.
3. Auth service validates credentials, OTP, refresh token, or reset token as it does today.
4. Backend sets or clears cookies exactly as it does today.
5. Frontend receives success or a real auth/domain error.

### Recommended Implementation Path

1. Remove the `ForbiddenException('Invalid request origin')` path from `assertAllowedOrigin()`.
2. Keep auth controller call sites intact unless they become dead code after cleanup.
3. Remove or rewrite tests that assert origin rejection.
4. Keep cookie mutation and session-response behavior unchanged.

### Error Handling

This change removes only one error path:

- `403 Forbidden` with `Invalid request origin`

All other auth failures should remain unchanged, including:

- invalid credentials
- inactive/deactivated account handling
- subscription or role-based authorization failures
- rate limiting
- invalid OTP or expired reset token failures

### Security Trade-Off

This intentionally removes origin-based protection from browser auth mutation routes. That is a weaker security posture than the current production behavior.

This trade-off is explicitly accepted for this change because the requested behavior is to make auth work without any origin requirement.

## Test Plan

Update backend tests to reflect the new behavior:

- remove or rewrite tests that expect disallowed origins to throw `ForbiddenException`
- keep cookie path, lifetime, and mutation tests intact
- keep controller tests that verify login, OTP, refresh, logout, and reset flows still call services and set cookies correctly
- add or update coverage proving auth routes still proceed when an unexpected `Origin` header is present

## Acceptance Criteria

- Local frontend at `http://localhost:3000` can log in against the hosted backend without `Invalid request origin`
- OTP request and verify flows no longer fail because of request origin
- Refresh and logout flows no longer fail because of request origin
- Backend tests pass with the updated auth-origin behavior
- No changes to cookie names, cookie paths, or response payload shapes

## Rollout Notes

- This is a backend-only behavior change
- Frontend environment values do not need to be updated for this fix
- If stricter origin enforcement is needed later, it should return as a separate, explicitly designed feature
