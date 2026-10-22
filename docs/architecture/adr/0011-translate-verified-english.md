# ADR-0011: Translate only verified English into Spanish and Hindi

- **Status:** Accepted
- **Date:** 2026-10-21
- **Decided by:** Akshay (decision card)

## Context

Agents reason in English. A translation can change a number or a name.

## Options

1. Agents write each language directly
2. Translate verified English with Azure AI Translator and re-check

## Decision

Translator S1 on verified English only, names protected with translate=no, a deterministic re-check of numbers and names, and the language dropped for a line that fails. Tamil stays off until a native speaker reviews it.

## Consequences

- One verification path; translation cannot introduce errors silently.
- Some lines may show in English only.

## Affects

- 10-voice-and-translation.md
