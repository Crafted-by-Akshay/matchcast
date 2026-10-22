# Platform lane (infra/, azure.yaml, .github/, scripts/ for cost and deploy)

Read first: root `CLAUDE.md`, then `docs/architecture/13-deployment-and-operations.md`, `14-security-and-responsible-ai.md`, `15-observability.md`, ADR-0005 to 0008, `docs/infra.md`.
Skills: `azure-deploy`, `verification-loop`, `handoff`. Agent: `azure-helper`.

- Bicep must build with no warnings; show `azd provision --preview` in the PR.
- Managed identity and RBAC only. No key or connection string in app settings. New roles go in `modules/roles.bicep` and the doc 13 matrix.
- Never delete resources; stay inside the budget caps; adding a paid service needs an approved ADR.
- Azure commands run on the Mac mini (`az login`). Record what you could not run as not verified.
- Owns `.github/` and the PR template. Actions is down: keep workflows valid, and keep `scripts/local_ci.sh` in step with `ci.yml`.
