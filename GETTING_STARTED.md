# Getting Started - TextileBill Backend

This guide will help you set up and run the TextileBill backend API in under 10 minutes.

## Prerequisites

- **Node.js** v20 LTS ([Download](https://nodejs.org/))
- **PostgreSQL** 16+ (Local or [Supabase](https://supabase.com))
- **Redis** ([Download](https://redis.io/download) or use Docker)
- **Git** ([Download](https://git-scm.com/))

## Quick Setup (5 Steps)

### 1. Install Dependencies

```bash
npm install
```

This will install all required packages (~435MB).

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env and set these REQUIRED values:
# - DATABASE_URL: Your PostgreSQL connection string
# - JWT_SECRET: Generate with: openssl rand -base64 32
# - JWT_REFRESH_SECRET: Generate with: openssl rand -base64 32
# - APP_SECRET_KEY: Generate with: openssl rand -base64 32
```

**Minimum .env for local development:**

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/textilebill
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=<your-generated-secret>
JWT_REFRESH_SECRET=<your-generated-refresh-secret>
APP_SECRET_KEY=<your-generated-app-secret>
ADMIN_TENANT_CREATION_PASSWORD=change-this-password
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=admin123
```

### 3. Setup Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# (Optional) Seed test data
npm run seed
```

### 4. Start Redis

```bash
# If you have Docker:
docker run -d -p 6379:6379 redis:7-alpine

# Or start your local Redis server
redis-server
```

### 5. Start Development Server

```bash
npm run start:dev
```

Server will start at **http://localhost:3001**

## Verify Setup

### 1. Health Check

```bash
curl http://localhost:3001/api/health
```

Expected response: `{"status":"ok"}`

### 2. API Documentation

Open in browser: **http://localhost:3001/api/docs**

### 3. Test Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

You should receive a JWT token.

## Project Structure

```
textilebill-backend/
├── src/
│   ├── modules/              # Feature modules
│   │   ├── auth/             # Authentication
│   │   ├── company/          # Company management
│   │   ├── invoice/          # Invoicing
│   │   ├── product/          # Products
│   │   └── ...               # 15 total modules
│   ├── common/               # Shared utilities
│   ├── config/               # Configuration
│   └── main.ts               # Application entry
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Migration history
├── docs/                     # Documentation
└── .env                      # Environment variables
```

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start in development mode (watch) |
| `npm run build` | Build for production |
| `npm run start:prod` | Start in production mode |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run prisma:studio` | Open Prisma Studio (DB GUI) |
| `npm run prisma:migrate` | Run migrations |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## Email Configuration (Optional)

If you want to enable email features:

1. Get Gmail App Password: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

2. Add to .env:

```env
MAIL_ENABLED=true
MAIL_TRANSPORT=gmail
MAIL_GMAIL_USER=your-email@gmail.com
MAIL_GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
MAIL_GMAIL_FROM=your-email@gmail.com
```

## Troubleshooting

### Database Connection Failed

- Verify PostgreSQL is running
- Check `DATABASE_URL` format is correct
- Test connection: `npx prisma db pull`

### Redis Connection Failed

- Verify Redis is running: `redis-cli ping` (should return PONG)
- Check `REDIS_HOST` and `REDIS_PORT` in .env

### Port Already in Use

```bash
# Change port in .env
PORT=3002
```

### Prisma Client Not Generated

```bash
npm run prisma:generate
```

### Migration Failed

```bash
# Reset database (WARNING: deletes all data)
npm run prisma:reset

# Or manually fix and retry
npm run prisma:migrate
```

## Next Steps

1. **Read API Documentation**: [docs/API_CONTRACT.md](docs/API_CONTRACT.md)
2. **Understand Architecture**: [docs/TECH_STACK_CURRENT.md](docs/TECH_STACK_CURRENT.md)
3. **Configure Deployment**: [docs/deployment/README.md](docs/deployment/README.md)

## Support

- **API Reference**: `docs/API_CONTRACT.md`
- **Tech Stack**: `docs/TECH_STACK_CURRENT.md`
- **Environment Variables**: `docs/backend/env-variables-reference.md`

---

**Ready to code! 🚀**
