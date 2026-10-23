#!/usr/bin/env bash
# Deploy from this machine, no GitHub Actions: build and push the images, point the azd env at them,
# provision, deploy the recap function and run the smoke test. Needs Docker, `az login`, `azd`,
# and `docker login ghcr.io` (gh auth token | docker login ghcr.io -u <user> --password-stdin).
# Usage: scripts/deploy_local.sh [api] [web] [mcp]   (default: all three)
# Pushes linux/amd64 images, because Container Apps run amd64 and this may be an Apple-silicon Mac.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REGISTRY=ghcr.io/crafted-by-akshay
ENV_NAME=${AZURE_ENV_NAME:-dev}
SERVICES=("$@")
[ ${#SERVICES[@]} -eq 0 ] && SERVICES=(api web mcp)

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; the image tag would not match what is built" >&2
  exit 1
fi
SHA=sha-$(git rev-parse --short HEAD)
echo "deploying $SHA to azd env $ENV_NAME: ${SERVICES[*]}"

for s in "${SERVICES[@]}"; do
  case "$s" in
    api) docker buildx build --platform linux/amd64 -f services/api/Dockerfile -t "$REGISTRY/matchcast-api:$SHA" --push . ;;
    mcp) docker buildx build --platform linux/amd64 -f services/mcp/Dockerfile -t "$REGISTRY/matchcast-mcp:$SHA" --push . ;;
    web)
      API_FQDN=$(az containerapp show -g rg-matchcast -n "ca-api-matchcast-$ENV_NAME" --query properties.configuration.ingress.fqdn -o tsv)
      docker buildx build --platform linux/amd64 --build-arg API_URL="https://$API_FQDN" \
        -t "$REGISTRY/matchcast-web:$SHA" --push apps/unified ;;
    *) echo "unknown service $s" >&2; exit 2 ;;
  esac
  azd env set "$(echo "$s" | tr a-z A-Z)_IMAGE" "$REGISTRY/matchcast-$s:$SHA" -e "$ENV_NAME"
done

# A service that is not rebuilt keeps the image it runs now, so provision never resets it to the placeholder.
for s in api web mcp; do
  case " ${SERVICES[*]} " in *" $s "*) continue ;; esac
  current=$(az containerapp show -g rg-matchcast -n "ca-$s-matchcast-$ENV_NAME" --query 'properties.template.containers[0].image' -o tsv)
  azd env set "$(echo "$s" | tr a-z A-Z)_IMAGE" "$current" -e "$ENV_NAME"
done

azd provision -e "$ENV_NAME" --no-prompt
azd deploy recap -e "$ENV_NAME" --no-prompt || echo "warning: azd deploy recap failed; the recap function keeps its previous code"

API_URI=$(azd env get-value API_URI -e "$ENV_NAME")
curl -fsS --retry 12 --retry-delay 15 --retry-all-errors "$API_URI/ready" >/dev/null
python3 scripts/smoke_pipeline.py --base "$API_URI"
echo "deployed $SHA"
