#!/usr/bin/env bash
set -euo pipefail

# Build and push backend image to Amazon ECR.
# Usage:
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-south-1 ./scripts/push-ecr-image.sh
# Optional:
#   ECR_REPOSITORY=textilebill-backend
#   IMAGE_TAG=v1.0.0
#   CREATE_REPOSITORY=true
#   RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-...?... 

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:-textilebill-backend}"
CREATE_REPOSITORY="${CREATE_REPOSITORY:-false}"
RENDER_DEPLOY_HOOK_URL="${RENDER_DEPLOY_HOOK_URL:-}"

if [[ -z "$AWS_ACCOUNT_ID" ]]; then
  echo "ERROR: AWS_ACCOUNT_ID is required"
  exit 1
fi

if [[ "$AWS_ACCOUNT_ID" == "YOUR_AWS_ACCOUNT_ID" ]]; then
  echo "ERROR: Replace placeholder YOUR_AWS_ACCOUNT_ID with your real 12-digit AWS account ID"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI is required"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required"
  exit 1
fi

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
if [[ -z "${IMAGE_TAG:-}" ]]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IMAGE_TAG="$(git rev-parse --short HEAD)"
  else
    IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"
  fi
fi

IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
LATEST_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"

if [[ "$CREATE_REPOSITORY" == "true" ]]; then
  aws ecr describe-repositories \
    --repository-names "$ECR_REPOSITORY" \
    --region "$AWS_REGION" >/dev/null 2>&1 || \
  aws ecr create-repository \
    --repository-name "$ECR_REPOSITORY" \
    --image-scanning-configuration scanOnPush=true \
    --region "$AWS_REGION" >/dev/null
fi

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker build -t "$IMAGE_URI" -t "$LATEST_URI" .
docker push "$IMAGE_URI"
docker push "$LATEST_URI"

echo "Pushed image: $IMAGE_URI"
echo "Pushed image: $LATEST_URI"

if [[ -n "$RENDER_DEPLOY_HOOK_URL" ]]; then
  echo "Triggering Render deploy hook"
  curl -fsSL -X POST "$RENDER_DEPLOY_HOOK_URL" >/dev/null
  echo "Render deploy triggered"
else
  echo "Render deploy hook not configured; trigger deploy from Render dashboard."
fi
