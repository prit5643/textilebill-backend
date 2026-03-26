#!/usr/bin/env bash
set -euo pipefail

# Build backend image, push to Docker Hub, then optionally trigger Render deploy.
#
# Required env vars:
#   DOCKERHUB_USERNAME=your-dockerhub-user
#   DOCKERHUB_REPOSITORY=textilebill-backend
#
# Optional env vars:
#   IMAGE_TAG=2026-03-23-1      (default: git short sha or timestamp)
#   DOCKERHUB_NAMESPACE=org     (default: DOCKERHUB_USERNAME)
#   RENDER_DEPLOY_HOOK_URL=...  (if set, script triggers a deploy after push)
#
# Usage:
#   DOCKERHUB_USERNAME=alice DOCKERHUB_REPOSITORY=textilebill-backend ./scripts/push-dockerhub-and-deploy-render.sh

DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-}"
DOCKERHUB_REPOSITORY="${DOCKERHUB_REPOSITORY:-}"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-$DOCKERHUB_USERNAME}"
RENDER_DEPLOY_HOOK_URL="${RENDER_DEPLOY_HOOK_URL:-}"

if [[ -z "$DOCKERHUB_USERNAME" ]]; then
  echo "ERROR: DOCKERHUB_USERNAME is required"
  exit 1
fi

if [[ -z "$DOCKERHUB_REPOSITORY" ]]; then
  echo "ERROR: DOCKERHUB_REPOSITORY is required"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required"
  exit 1
fi

if [[ -z "${IMAGE_TAG:-}" ]]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    GIT_SHA="$(git rev-parse --short HEAD)"
    if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
      IMAGE_TAG="${GIT_SHA}-$(date +%Y%m%d-%H%M%S)"
    else
      IMAGE_TAG="$GIT_SHA"
    fi
  else
    IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"
  fi
fi

IMAGE_NAME="${DOCKERHUB_NAMESPACE}/${DOCKERHUB_REPOSITORY}"
TAGGED_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
LATEST_IMAGE="${IMAGE_NAME}:latest"

echo "Building image: ${TAGGED_IMAGE}"
docker build -t "$TAGGED_IMAGE" -t "$LATEST_IMAGE" .

echo "Pushing images to Docker Hub"
docker push "$TAGGED_IMAGE"
docker push "$LATEST_IMAGE"

echo "Pushed: $TAGGED_IMAGE"
echo "Pushed: $LATEST_IMAGE"

if [[ -n "$RENDER_DEPLOY_HOOK_URL" ]]; then
  echo "Triggering Render deploy hook with cache clear"
  # Add clearCache=true to force Render to pull the latest image
  if [[ "$RENDER_DEPLOY_HOOK_URL" == *"?"* ]]; then
    DEPLOY_URL="${RENDER_DEPLOY_HOOK_URL}&clearCache=true"
  else
    DEPLOY_URL="${RENDER_DEPLOY_HOOK_URL}?clearCache=true"
  fi
  curl -fsSL -X POST "$DEPLOY_URL" >/dev/null
  echo "Render deploy triggered (cache cleared - will pull latest image)"
else
  echo "Render deploy hook not configured; trigger deploy from Render dashboard."
  echo "TIP: Set RENDER_DEPLOY_HOOK_URL and run again to auto-deploy with cache clear"
fi
