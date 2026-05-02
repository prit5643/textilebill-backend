# ECR + Render Runbook (Backend)

This runbook lets you push the backend as a Docker image to Amazon ECR and run that exact image on Render.

## 1) Prerequisites

- AWS account with ECR permissions.
- AWS CLI configured locally:
  - aws configure
- Docker installed and running.
- Backend repository checked out locally.

Required IAM permissions:
- ecr:GetAuthorizationToken
- ecr:BatchCheckLayerAvailability
- ecr:InitiateLayerUpload
- ecr:UploadLayerPart
- ecr:CompleteLayerUpload
- ecr:PutImage
- ecr:DescribeRepositories
- ecr:CreateRepository (only if CREATE_REPOSITORY=true)

## 2) Push backend image to ECR

From backend root:

AWS_ACCOUNT_ID=YOUR_AWS_ACCOUNT_ID AWS_REGION=ap-south-1 CREATE_REPOSITORY=true ./scripts/push-ecr-image.sh

Optional custom values:

AWS_ACCOUNT_ID=YOUR_AWS_ACCOUNT_ID AWS_REGION=ap-south-1 ECR_REPOSITORY=textilebill-backend IMAGE_TAG=v1.0.0 ./scripts/push-ecr-image.sh

The script pushes two tags:
- account.dkr.ecr.region.amazonaws.com/repository:TAG
- account.dkr.ecr.region.amazonaws.com/repository:latest

## 3) Configure Render to use ECR image

In Render, create a new Web Service using Docker image.

Image URL format:
- YOUR_AWS_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/textilebill-backend:latest

Registry credentials in Render:
- Username: AWS
- Password: output of:
  - aws ecr get-login-password --region ap-south-1

If Render asks for registry server:
- YOUR_AWS_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

## 4) Backend environment variables on Render

Set at least:
- NODE_ENV=production
- PORT=3001
- API_PREFIX=api
- DATABASE_URL=your runtime database url
- DATABASE_DIRECT_URL=your direct db url for migrations
- REDIS_HOST=your redis host
- REDIS_PORT=6379
- REDIS_PASSWORD=your redis password
- JWT_SECRET=strong random value
- JWT_REFRESH_SECRET=different strong random value
- APP_SECRET_KEY=strong random value
- CORS_ORIGIN=https://your-frontend-domain

## 5) Deploy update flow

Every code update:
1. Build and push new image tag to ECR.
2. In Render, update service image tag and deploy.
3. Verify endpoint:
   - https://your-backend-domain/api/system/health

## 6) Rollback flow

If release fails:
1. Pick previous ECR image tag.
2. Repoint Render service to previous tag.
3. Deploy.

## 7) Notes

- Using image tags (not only latest) is recommended for reliable rollback.
- Keep AWS credentials and JWT/app secrets out of source control.
