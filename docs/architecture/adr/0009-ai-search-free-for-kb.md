# ADR-0009: AI Search Free tier for the knowledge base, with a Blob fallback

- **Status:** Accepted (Akshay, 22 Oct 2026)
- **Date:** 2026-10-22
- **Decided by:** Agents lane

## Context

The chatbot needs hybrid retrieval over about 700 chunks (about 6 MB). AI Search Basic is roughly a third of $200 a month, which breaks the $50 plan. Free gives 50 MB and 3 indexes but no managed identity and no semantic ranker, and an inactive Free service may be deleted.

## Options

1. Basic tier (managed identity, semantic ranker)
2. Free tier with keys in Key Vault and a Blob fallback
3. No search service: in-memory search in api only

## Decision

Free tier. Query key and admin key in Key Vault; api loads kb/v1/chunks.jsonl from Blob and serves in-memory BM25 + cosine if the service is unreachable. Vector search on Free is to be confirmed on day 1; if unsupported, the index is keyword-only and vectors are used by the fallback only.

## Consequences

- Uses Azure AI Search for real at no cost.
- Two stored secrets (documented exceptions) and a fallback path to test.

## Affects

- 05-assistant-rag.md
