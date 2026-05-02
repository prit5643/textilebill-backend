# Backend Deployment Guide (Heroku)

This document outlines the standard deployment process for the TextileBill Backend API to Heroku.

## Platform Overview
- **Platform:** Heroku
- **Application Name (Prod):** `textilebill-api-prod`
- **Application Name (Staging):** `textilebill-api-staging`
- **Production URL:** `https://textilebill-api-prod.herokuapp.com`

## Prerequisites
1. Heroku CLI installed (`brew tap heroku/brew && brew install heroku`).
2. Logged into Heroku CLI (`heroku login`).
3. App created in Heroku dashboard.

## Environment Variables
Set these via the Heroku Dashboard -> Settings -> Config Vars:
- `DATABASE_URL`: Production PostgreSQL URI (e.g., Supabase transaction pooler).
- `JWT_SECRET`: Production secret for session signing.
- `NODE_ENV`: `production`
- *Note:* Do NOT set `PORT` manually; Heroku assigns this dynamically.

## Process Configuration (Procfile)
The root of the repository contains a `Procfile`:
```yaml
release: echo "Skipping release migrations"
web: npm run start:prod
```

## Deployment Steps

To deploy the application and safely apply Prisma V2 migrations:

```bash
# 1. Push code to Heroku
git push heroku refactor:main

# 2. Run Database Migrations securely against the production DB
heroku run npx prisma migrate deploy --app textilebill-api-prod

# 3. Restart Dynos to clear stale Prisma connections
heroku restart --app textilebill-api-prod
```

## Health Check
Verify the deployment by hitting the health endpoint:
```
curl https://textilebill-api-prod.herokuapp.com/api/health
```
