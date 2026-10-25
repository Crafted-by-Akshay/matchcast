---
name: azure-deploy
description: Use when changing Bicep or azd, provisioning or deploying MatchCast to Azure, container images, OIDC, Entra sign-in, scaling or the cost guardrails.
---

# Azure deploy

Docs: `docs/infra.md`, `docs/architecture/13-deployment-and-operations.md`, ADR-0005 to 0008, `docs/runbook-shutdown.md`. Owner: Platform lane.

## Facts
Subscription "Azure subscription 1", resource group `rg-matchcast` (East US), Foundry `matchcast-foundry` (East US 2, project `proj-default`, deployment `gpt-5-mini`), identity `id-matchcast`, Key Vault with RBAC, Storage tables and containers, Event Hubs Basic (hub `match-events`, consumer group `$Default` only), Container Apps `web`, `api`, `mcp` scaling 0 to 1 (api also on the Event Hubs backlog via KEDA, threshold 50). Images on GHCR (`ghcr.io/crafted-by-akshay/matchcast-*`, ADR-0008). Template: `infra/main.bicep` plus `infra/modules/*.bicep`, driven by `azure.yaml`.

## Rules
- Azure commands run only where `az login` is done (the Mac mini). Provisioning in `rg-matchcast` is pre-authorised within the caps; deleting anything is not. The deny list blocks `azd down` and group or resource delete.
- Budget: about $60 planned, under $100 worst case; alerts $40 and $50; `scripts/cost_today.sh`. A change that adds a paid service needs an ADR Akshay approved. Stop everything that bills by the hour after judging (runbook).
- No key or connection string in app settings, files or logs. Managed identity and RBAC; the one known secret is `entra-client-secret` in Key Vault. New role assignments go in `infra/modules/roles.bicep` (public role GUIDs are allow-listed in `.gitleaks.toml`) and in the doc 13 RBAC matrix.
- `az bicep build --file infra/main.bicep` must give no warnings (`scripts/local_ci.sh bicep`). Run `azd provision --preview` and put the output in the PR.
- Deploy on merge is `.github/workflows/deploy.yml`: OIDC federated credential bound to the `production` environment, skipped until the repo variables exist. GitHub Actions is down for now, so deploy by hand from the Mac mini with `azd` and record the command and result in `docs/infra.md`.
- Label as not verified anything you could not run (the file already lists what is unverified).
