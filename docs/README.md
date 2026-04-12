# TextileBill Backend Documentation

This folder is the backend documentation index for the schema-aligned codebase.
To maintain clarity and reduce ambiguity for engineering teams and AI agents, documentation is organized into clear subdirectories.

## Documentation Navigation

### [api/](./api/)
Integration contracts for external interfaces and the frontend.
- `API_CONTRACT.md` (Current REST API endpoints and payload behaviors)

### [architecture/](./architecture/)
System design, high-level behavior, and active database structure.
- `TECH_STACK_CURRENT.md`
- `app-workflow-and-behavior-guide.md`
- `database-schema.md` (The source of truth for the active Prisma models)

### [development/](./development/)
Guides for setting up the local environment and navigating the codebase.
- `setup-guide.md`
- `env-variables-reference.md`
- `code-navigation.md`

### [operations/](./operations/)
Runbooks and guides for managing the schema and running the application backend.
- `backend-operations-handbook.md`
- `database-operations.md`
- `data-validation.md`

### [security/](./security/)
Details on authentication strategies and security observability mechanisms.
- `authentication-flows.md`
- `security-observability.md`

### [testing/](./testing/)
Playbooks and scenarios for preventing regressions and verifying functional expectations.
- `regression-playbook.md`
- `test-scenarios.md`

### [features/](./features/)
Inventories and details of specific feature implementations.
- `features.md`
- `mail-configuration.md`

### [deployment/](./deployment/)
Guides for deploying the application to staging and production environments.
- `DEPLOYMENT_GUIDE.md`
- `ECR_RENDER_RUNBOOK.md`
