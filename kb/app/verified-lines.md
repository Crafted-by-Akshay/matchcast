---
title: Verified lines and the Verifier
---

## What the Verifier checks

Every line is checked before it can appear. The Verifier confirms that the cited source events exist, that the claim is fresh, that each number matches a recount from the stored events, that every name belongs to this match, that the line fits its style limits, and that the text is safe.

## What happens when a line fails

A rejected line is repaired once, for example by rebuilding the claim from the event log. If the second version also fails, the line is dropped and the audit trail records why. Nothing unverified is shown as fact.

## Rules fallback

If a model is slow or unavailable, deterministic rule-based agents take over and the screen shows a Rules fallback label. Lines from the rules path use templates filled only from verified claim values.

## The audit trail

Each step appends a record linked to the one before it by a hash, so any change to the history breaks the chain and shows up when the chain is verified.
