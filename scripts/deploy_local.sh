#!/usr/bin/env bash
# Deploy from this machine, no GitHub Actions: build and push the images, point the azd env at them,
# provision, deploy the recap function and run the smoke test. Needs Docker, `az login`, `azd`,
# and `docker login ghcr.io` (gh auth token | docker login ghcr.io -u <user> --password-stdin).
# BUILD=acr (scripts/deploy_cloud.sh) builds in Azure Container Registry instead: no Docker needed.
# Usage: scripts/deploy_local.sh [api] [web] [mcp]   (default: all three)
# Pushes linux/amd64 images, because Container Apps run amd64 and this may be an Apple-silicon Mac.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REGISTRY=ghcr.io/crafted-by-akshay
ENV_NAME=${AZURE_ENV_NAME:-dev}
BUILD=${BUILD:-docker}

# Three tries a minute apart: a cloud build can hit a Docker Hub rate limit, and a provision right
# after the registry's AcrPull assignment can run before the role has propagated.
retry() {
  for n in 1 2 3; do
    "$@" && return 0
    [ "$n" = 3 ] && return 1
    echo "retrying in 60 s: $*" >&2
    sleep 60
  done
}

# `azd provision` checks for Docker because azure.yaml declares Docker services, so the acr path
# deploys main.bicep with az and the parameters azd would pass (scripts/azd_params.py).
provision_acr() {
  local params
  params=$(mktemp)
  azd env get-values -e "$ENV_NAME" | python3 scripts/azd_params.py infra/main.parameters.json > "$params"
  az deployment group create -g rg-matchcast -n "$ENV_NAME-$(date +%s)" \
    -f infra/main.bicep -p "@$params" --only-show-errors -o none
  rm -f "$params"
}

provision() {
  if [ "$BUILD" = acr ]; then
    provision_acr
  else
    azd provision -e "$ENV_NAME" --no-prompt
  fi
}
SERVICES=("$@")
[ ${#SERVICES[@]} -eq 0 ] && SERVICES=(api web mcp)

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; the image tag would not match what is built" >&2
  exit 1
fi
SHA=sha-$(git rev-parse --short HEAD)
echo "deploying $SHA to azd env $ENV_NAME: ${SERVICES[*]}"

if [ "$BUILD" = acr ]; then
  ACR=$(az acr list -g rg-matchcast --query "[?starts_with(name, 'acrmatchcast')].name | [0]" -o tsv)
  if [ -z "$ACR" ]; then
    echo "no registry yet: provisioning it with the images that run now"
    for s in api web mcp; do
      current=$(az containerapp show -g rg-matchcast -n "ca-$s-matchcast-$ENV_NAME" --query 'properties.template.containers[0].image' -o tsv)
      if [ -n "$current" ]; then azd env set "$(echo "$s" | tr a-z A-Z)_IMAGE" "$current" -e "$ENV_NAME"; fi
    done
    retry provision
    ACR=$(az acr list -g rg-matchcast --query "[?starts_with(name, 'acrmatchcast')].name | [0]" -o tsv)
  fi
  REGISTRY=$(az acr show -n "$ACR" --query loginServer -o tsv)
  for s in "${SERVICES[@]}"; do
    case "$s" in
      api) retry az acr build -r "$ACR" --platform linux/amd64 -f services/api/Dockerfile -t "matchcast-api:$SHA" . ;;
      mcp) retry az acr build -r "$ACR" --platform linux/amd64 -f services/mcp/Dockerfile -t "matchcast-mcp:$SHA" . ;;
      web)
        API_FQDN=$(az containerapp show -g rg-matchcast -n "ca-api-matchcast-$ENV_NAME" --query properties.configuration.ingress.fqdn -o tsv)
        retry az acr build -r "$ACR" --platform linux/amd64 --build-arg API_URL="https://$API_FQDN" -t "matchcast-web:$SHA" apps/unified ;;
      *) echo "unknown service $s" >&2; exit 2 ;;
    esac
    azd env set "$(echo "$s" | tr a-z A-Z)_IMAGE" "$REGISTRY/matchcast-$s:$SHA" -e "$ENV_NAME"
  done
else
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
fi

# A service that is not rebuilt keeps the image it runs now, so provision never resets it to the placeholder.
for s in api web mcp; do
  case " ${SERVICES[*]} " in *" $s "*) continue ;; esac
  current=$(az containerapp show -g rg-matchcast -n "ca-$s-matchcast-$ENV_NAME" --query 'properties.template.containers[0].image' -o tsv)
  if [ -n "$current" ]; then azd env set "$(echo "$s" | tr a-z A-Z)_IMAGE" "$current" -e "$ENV_NAME"; fi
done

retry provision
azd deploy recap -e "$ENV_NAME" --no-prompt || echo "warning: azd deploy recap failed; the recap function keeps its previous code"

API_URI=$(azd env get-value API_URI -e "$ENV_NAME")
curl -fsS --retry 12 --retry-delay 15 --retry-all-errors "$API_URI/ready" >/dev/null
python3 scripts/smoke_pipeline.py --base "$API_URI"
echo "deployed $SHA"
