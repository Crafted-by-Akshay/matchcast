# ADR-0001: Document the architecture with arc42 sections, C4 diagrams and ADRs

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Akshay (asked for a full blueprint); Platform lane

## Context

Five Claude Code lanes build in parallel for five days. They need one unambiguous source of truth that CLAUDE.md can point to, and judges need diagrams they can read in two minutes.

## Options

1. Free-form design notes (what we had: DESIGN.md, the cost doc, the Claude Doc)
2. arc42 structure + C4 model diagrams + Nygard-style ADRs, all markdown with Mermaid in the repo

## Decision

Use arc42's sections as the backbone (goals and constraints, context, building blocks, runtime, deployment, cross-cutting concepts, decisions, quality, risks, glossary), C4 levels 1 and 2 for structure, and one ADR per decision. Mermaid diagrams live inside the markdown.

## Consequences

- Docs diff and review like code; diagrams stay in sync in the same PR.
- More files to keep current; the PR checklist enforces it.

## Affects

- README.md
- all numbered files
