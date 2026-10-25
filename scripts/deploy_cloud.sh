#!/usr/bin/env bash
# Deploy with the images built in Azure (az acr build), so this machine needs only az, azd, git and
# python3: no Docker, no local disk for image layers. Same steps and smoke test as deploy_local.sh.
# Usage: scripts/deploy_cloud.sh [api] [web] [mcp]   (default: all three)
set -euo pipefail
BUILD=acr exec "$(dirname "$0")/deploy_local.sh" "$@"
