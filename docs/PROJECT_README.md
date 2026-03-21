# TextileBill — Documentation Index

This is the single top-level documentation folder for the entire project.
Everything is separated into clear sections so nothing is mixed.

---

## Sections

### [`architecture/`](./architecture/README.md)
Technology decisions, product requirements, and system design.
- Tech stack choices (locked-in decisions)
- Full Product Requirements Document (PRD)

### [`implemented/`](./implemented/README.md)
Everything that is live in the codebase today.
- Single merged implemented snapshot (`implemented-master.md`)
- Detailed completed issue changelog

### [`backend/`](./backend/README.md)
Backend-specific engineering references for the NestJS API.
- One-file backend operations handbook
- Implemented features list
- Code navigation guide
- Database schema reference
- Database operations and migration guide
- Data validation reference
- Security and observability hardening runbook
- Data visibility regression playbook
- Test scenarios guide
- **Authentication flows** - Complete authentication documentation
- **Security audit report** - Comprehensive security analysis
- **Environment variables reference** - All backend configuration
- **Mail configuration** - Email setup and troubleshooting

### [`future/`](./future/README.md)
Things that are **not yet built** — planned features and infrastructure upgrades.
- Product roadmap and feature backlog
- PgBouncer / production infrastructure scaling guide

### [`testing/`](./testing/README.md)
QA reports, test verification docs, end-to-end checklists, and live runtime reports.
- Auth flow audit and browser test scenarios
- Email test reports
- Settings page investigation
- API test results and runtime reports

### [`design-specs/`](./design-specs/README.md)
Design notes written before each issue was implemented.
Historical reference for understanding why specific engineering decisions were made.

### [`deployment/`](./deployment/README.md) 🆕
Complete deployment guides for production.
- Step-by-step deployment checklist
- Deployment commands reference
- Supabase database setup
- Vercel + Render + Supabase configuration

### [`setup-guide.md`](./setup-guide.md) 🆕
Setup steps after latest code changes - development environment configuration.

---

## What Was Cleaned Up (2026-03-21)

### Latest Cleanup
| Old Location | Moved To | Why |
|---|---|---|
| `AUTHENTICATION_FLOWS.md` (root) | `docs/backend/authentication-flows.md` | Backend auth documentation |
| `AUTH_FLOW_AUDIT_2026-03-19.md` (root) | `docs/testing/auth-flow-audit-2026-03-19.md` | Testing documentation |
| `AUTH_BROWSER_TEST_SCENARIOS_2026-03-19.md` (root) | `docs/testing/auth-browser-test-scenarios.md` | Testing scenarios |
| `security.md` (root) | `docs/backend/security-audit.md` | Backend security documentation |
| `EMAIL_TEST_REPORT.md` (root) | `docs/testing/email-test-report.md` | Testing report |
| `SETTINGS_PAGE_INVESTIGATION.md` (root) | `docs/testing/settings-page-investigation.md` | Investigation report |
| `ENV_VARIABLES_REFERENCE.md` (root) | `docs/backend/env-variables-reference.md` | Backend configuration |
| `MAIL_CONFIGURATION_UPDATE.md` (root) | `docs/backend/mail-configuration.md` | Backend mail setup |
| `SETUP_STEPS_AFTER_CHANGES.md` (root) | `docs/setup-guide.md` | Setup documentation |
| `deployment.md` + `README_DEPLOYMENT.md` (root) | `docs/deployment/README.md` | Merged deployment guides |
| `DEPLOYMENT_CHECKLIST.md` (root) | `docs/deployment/checklist.md` | Deployment checklist |
| `deployment-commands.sh` (root) | `docs/deployment/commands.sh` | Deployment commands |
| `SUPABASE_SETUP.md` (root) | `docs/deployment/supabase-setup.md` | Database setup |
| `dump.rdb` (root) | **DELETED** | Redis dump file (temp) |
| `.DS_Store` (root) | **DELETED** | macOS system file |
| `design-system/` (root) | **DELETED** | Unused design reference |

### Previous Cleanup

| Old Location | Moved To | Why |
|---|---|---|
| `improvement.md` (root) | `docs/implemented/changelog.md` | Completed issue tracker sitting loose at root |
| `Additional_Features_and_Optimizations.md` (root) | `docs/future/roadmap.md` | Future feature ideas, not yet implemented |
| `Final Simplified Enterprise Stack.md` (root) | `docs/architecture/tech-stack.md` | Architecture reference, belongs in architecture section |
| `TextileBill SaaS — Full Product Requirements Docum.md` (root) | `docs/architecture/product-requirements.md` | PRD belongs in architecture section |
| `items.md` (root) | `docs/unnecessary/ai-analysis-prompt.md` | AI analysis prompt template, not a project doc |
| `textilebill-backend/docs/*.md` | `docs/backend/*.md` | Backend-specific docs consolidated here |
| `textilebill-backend/docs/database-connection-scaling.md` | `docs/future/infrastructure-scaling.md` | Not yet deployed — future infrastructure concern |
| `docs/superpowers/specs/*.md` | `docs/design-specs/*.md` | Renamed from confusing "superpowers" folder name |
