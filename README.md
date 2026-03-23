# TextileBill Backend API

Multi-tenant SaaS backend API for textile business management.

## Local (Without Docker)

```bash
npm install
cp .env.example .env
npm run db:setup
npm run start:dev
```

API: `http://localhost:3001`  
Swagger: `http://localhost:3001/api/docs`

## Docker Setup

1. Create env file:

```bash
cp .env.example .env
```

2. Update `.env` with your Supabase connection:

- `DATABASE_URL` = Supabase pooled URL (port `6543`) for runtime
- `DATABASE_DIRECT_URL` = Supabase direct URL (port `5432`) for migrations (optional but recommended)

3. Start stack (API + Redis, with Supabase as external DB):

```bash
docker compose up --build -d
```

4. Follow logs:

```bash
docker compose logs -f api
```

5. Stop stack:

```bash
docker compose down
```

### Docker Dev Mode (Hot Reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This mode starts the API with `npm run start:dev` and mounts your local source.  
If `DATABASE_DIRECT_URL` is set, migrations are applied on container startup; otherwise migration step is skipped.

## Documentation

- `docs/API_CONTRACT.md`
- `docs/TECH_STACK_CURRENT.md`
- `docs/setup-guide.md`
- `docs/deployment`
