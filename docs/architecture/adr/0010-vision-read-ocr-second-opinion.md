# ADR-0010: Azure AI Vision Read as a second opinion for shirt numbers

- **Status:** Proposed (needs Akshay's OK)
- **Date:** 2026-10-22
- **Decided by:** Data lane

## Context

The in-browser tracker identifies players 60 to 74% of the time on the Broadcast camera. The challenge names auto-eventing from video as an example.

## Options

1. Glyph templates only (today)
2. Send every frame to a cloud model
3. Glyph templates first, Vision Read OCR only for low-confidence tracks, capped at 15 calls a minute

## Decision

The third option, resource cv-matchcast-dev (S1) with managed identity, called through api /vision/identify.

## Consequences

- Measurable before/after identity accuracy for the video.
- Adds a resource and a small per-call cost; S1 per-call price to be checked in the calculator.

## Affects

- 09-vision-identification.md
