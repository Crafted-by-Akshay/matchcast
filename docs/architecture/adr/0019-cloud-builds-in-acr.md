# ADR-0019: Cloud image builds in Azure Container Registry

- **Status:** Accepted (amends ADR-0008)
- **Date:** 2026-10-24
- **Decided by:** Coordinator under Akshay's delegation (24 Oct, "take necessary calls"), Platform lane

## Context

Deploys built images with Docker (Colima) on Akshay's travel MacBook. On 24 Oct its disk had 1 to 2 GB free, the Colima VM disk gave I/O errors mid-build, and the deploy failed. GitHub Actions stays off (Akshay, 23 Oct), and the repository is private, so ADR-0008's "the repo is public" no longer holds either.

## Options

1. Keep local Docker builds and repair the VM each time it fills
2. `az acr build` in a Basic Azure Container Registry, pulled with the managed identity (AcrPull)
3. ACR tasks that push to GHCR (needs a GHCR token stored in Azure)

## Decision

Option 2. `scripts/deploy_cloud.sh [api] [web] [mcp]` (deploy_local.sh with `BUILD=acr`) uploads the source and builds linux/amd64 images in `acrmatchcast<suffix>`, Basic, admin user off. A Container App gets a `registries` entry with the user-assigned identity only when its image is under the registry, so GHCR images keep working and a first provision does not wait for the role. `scripts/deploy_local.sh` stays for machines with Docker.

## Consequences

- The deploying machine needs only az, azd, git, curl and python3: no Docker, no image layers on disk.
- The build context is uploaded to Azure, so both `.dockerignore` files exclude `.azure`, `.env*`, `*.pem` and `*.key`.
- Builds and the provision retry three times a minute apart (Docker Hub rate limits, AcrPull propagation).
- `azd provision` refuses to run without Docker because azure.yaml declares Docker services (found 25 Oct), so the acr path deploys `infra/main.bicep` with `az deployment group create`, with parameters rendered from the azd env by `scripts/azd_params.py`. The azd postprovision hook does not run on that path; it only re-stores the search keys, which are already in Key Vault.
- Cost: Basic is about $0.17 a day (about $5 to 20 Nov) plus build seconds; inside the ~$100 cap.
- Images are private in ACR; no pull secret anywhere.

## Affects

- 13-deployment-and-operations.md, docs/infra.md
