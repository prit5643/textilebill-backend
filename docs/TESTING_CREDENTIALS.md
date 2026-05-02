# Test Environment Credentials

The following accounts are available in the local testing database across both the Backend and Frontend development servers.

**LOGIN URL:** `http://localhost:3000/login`
*(Note: There is no `/signup` route. All access is provisioned via the root admin or database seeding).*

All accounts are mapped to the core tenant domain for safe feature interaction.

## Super Admin / Instance Owner (Full Read/Write)
**Email:** `root@textilebill.local`
**Password:** `ChangeMe@123`

*(Note: Other mock roles like admin/manager/viewer are dynamically seeded only during E2E testing, not the primary database seed. Please use the Super Admin credentials above for all local browser UI testing).*
