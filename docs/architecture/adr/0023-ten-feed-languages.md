# ADR-0023: Ten feed languages, each checked after translation

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decided by:** Akshay (go on multi-language, 25 Oct; the ten most popular languages)
- **Amends:** ADR-0011 (which named Spanish and Hindi only)

## Context

Rule 4.1 (vi) asks for multi-language storytelling, and one crew should serve many markets. Translation exists for English, Spanish and Hindi. Agents write in English, and a translation can change a number or a name.

## Options

1. Agents write each language directly
2. Translate the verified English line with Azure AI Translator and re-check it, for every feed and every language
3. Translate only the booth line

## Decision

Option 2. The languages are `en, es, pt, hi, ar, fr, de, id, ja, zh-Hans`. A line that the Verifier passed is translated when a viewer asks for its language, once per language, and the result is cached. A translation is kept only when numbers, names and citation markers match the English and no word from the neutral-wording list appears. Otherwise that language is dropped for that line, the viewer keeps English, and the audit chain records the reason. Tamil stays off until a native speaker reviews it.

## Consequences

- One verification path for every language; a translation cannot add a number or a name.
- Spoken output is limited to the languages with a voice in `voices.json` (en, es, pt, hi). Other languages show captions only.
- The Broadcast desk still writes its own rules templates in es and hi, so its other languages show English with a note.
- Character use is capped per api process by `TRANSLATOR_MAX_CHARS`. The free tier (2M characters a month) is for the demo and judging; the Azure change to F0 is a Platform-lane step.

## Affects

- 10-voice-and-translation.md §8
- 12-api.md (stream and ask `lang`)
