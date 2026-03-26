# Deployment Report - 2026-03-23

## Objective

Prepare production-ready deployment assets for:
- Backend image push to Amazon ECR.
- Backend image consumption in Render.
- Frontend-to-backend connection clarity for Vercel.

## Implemented

### Backend

1. Added executable script:
- scripts/push-ecr-image.sh

What it does:
- Logs in to ECR.
- Optionally creates ECR repository.
- Builds Docker image from backend root.
- Pushes tagged and latest images.

2. Added backend deployment runbook:
- docs/ECR_RENDER_RUNBOOK.md

What it contains:
- Prerequisites and AWS IAM requirements.
- Exact command to push image to ECR.
- Render image setup and registry auth details.
- Required backend environment variables.
- Rollback approach by image tag.

### Frontend

1. Added frontend backend-connection report:
- textilebill-frontend/docs/FRONTEND_BACKEND_CONNECTION_REPORT_2026-03-23.md

What it clarifies:
- Why browser requests show frontend domain while backend URL is still used.
- Required Vercel env value.
- Option to switch to direct backend base URL if needed.

## Validation

- Script is executable.
- No destructive changes were made to existing deployment code paths.

## Next action

Run from backend root:

AWS_ACCOUNT_ID=YOUR_AWS_ACCOUNT_ID AWS_REGION=ap-south-1 CREATE_REPOSITORY=true ./scripts/push-ecr-image.sh

Then configure Render service image URL to the pushed ECR image tag.
