# ADR-0008: Public container images on GitHub Container Registry

- **Status:** Accepted
- **Date:** 2026-10-21
- **Decided by:** Akshay (cost plan)

## Context

Azure Container Registry Basic costs about $5 a month; images contain no secrets and the repo is public.

## Options

1. Azure Container Registry with managed identity pull
2. GHCR public packages

## Decision

Build and push to ghcr.io/crafted-by-akshay/matchcast-{web,api,mcp}, public, tagged sha-<short sha> and latest.

## Consequences

- No registry cost, no pull secret.
- Images are public (acceptable: the repo is public too).

## Affects

- 13-deployment-and-operations.md
