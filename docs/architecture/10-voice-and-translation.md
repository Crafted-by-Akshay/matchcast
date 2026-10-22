# 10 Voice and live translation

Status: **Agreed design**. Last reviewed 22 Oct 2026. Backlog: EXP-8, EXP-16, EXP-17.

## 1. Languages and voices

| Language | Code | Voice (commentary) | Voice (analyst) | Status |
| --- | --- | --- | --- | --- |
| English | `en` | `en-GB-RyanNeural` | `en-GB-SoniaNeural` | v1 |
| Spanish | `es` | `es-ES-ElviraNeural` | `es-ES-ElviraNeural` | v1 |
| Hindi | `hi` | `hi-IN-SwaraNeural` | `hi-IN-SwaraNeural` | v1 |
| Tamil | `ta` | none | none | Off until a native speaker reviews it |

Voices are configured only in `services/api/config/voices.json`. Player voices for Talk are assigned there by `player_id`. The contracts' `language` enum becomes `en | es | hi | ta` in v1.1.

## 2. Text to speech (commentary)

- Synthesis runs in `api`, never in the browser, with `id-matchcast` (role Cognitive Services User) on `spch-matchcast-dev` (S0, East US 2).
- Output: MP3 24 kHz mono to Blob `audio/{prefix}/{publication_id}.{lang}.mp3`; the publication's `audio_generation_id` holds the blob name; the browser fetches it through `GET /v1/audio/{publication_id}.{lang}.mp3` (api streams it, so Blob stays private).
- Lines older than 5 s (publication expiry) are captioned but not voiced. At most one line is voiced at a time per view; a priority 1 line interrupts.
- Every line is synthesised live (Akshay, 21 Oct: no pre-rendered audio counted against the plan).

## 3. Speech to text (Talk and voice questions)

- The browser uses the Speech SDK with a short-lived token from `GET /v1/speech/token` (10 minutes, issued by `api` with the managed identity). No key reaches the browser.
- Push-to-talk only; typed input is always available. Recognition language follows the viewer's language picker.
- The recognised text goes to `/talk` or `/ask` like typed text, so Prompt Shields and the Verifier apply.

## 4. Live translation

```mermaid
flowchart LR
  en[verified English publication] --> act{language has<br/>≥ 1 active viewer?}
  act -- no --> skip[skip]
  act -- yes --> mark[wrap player and club names<br/>in translate=no spans]
  mark --> tr[Translator v3 /translate<br/>textType html]
  tr --> chk[Verifier deterministic re-check:<br/>same numbers, same names]
  chk -- pass --> pub[add language variant]
  chk -- fail --> drop[drop this language for this line, audit]
  pub --> tts[synthesise in that language]
```

Rules:
1. Only verified English text is ever translated. Agents always work in English.
2. "Active viewer" means a browser that sent a heartbeat with that language in the last 30 s (SSE query parameter `lang`). Translation also stops after 500,000 characters in total (`TRANSLATOR_MAX_CHARS`, about $5 at the S1 price); after that, lines stay English with the note "Translation paused".
3. Translator resource `tr-matchcast-dev`, S1, with a custom subdomain so managed identity works (role Cognitive Services User).
4. The re-check compares the sets of numbers (digits normalised from Devanagari to ASCII for Hindi) and names between English and the translation. Any difference drops that language for that line.
5. Captions show in the chosen language. If a line has no variant in that language, the English line shows with a small "EN" tag.
6. Ask and Talk answers are translated the same way before they are shown.

Built (22 Oct, `matchcast_agents/translate.py`): `GET /stream?lang=es|hi` adds `variants: {<lang>: text}` to each publication that passed the re-check, and `POST /ask` with `lang` adds the same `variants` to its reply. The base packet stays English, so the contract's `language` enum does not change; variants are not stored. One Translator call per line and language, shared by every viewer. The re-check compares numbers (Devanagari digits and decimal commas normalised), names and `[claim:]`/`[kb:]` markers; a failure keeps the English and writes a `translation_rejected` audit record with the reason. Past the `TRANSLATOR_MAX_CHARS` cap (default 500,000) or with no `TRANSLATOR_ENDPOINT`, lines stay English and nothing is audited. The Translator is called with the api's managed identity (`TRANSLATOR_ENDPOINT` custom domain, optional `TRANSLATOR_REGION`). `lang=ta` is refused with 422 until Tamil is reviewed. Limits: the character cap counts the HTML sent and lives in one api process, so it resets on restart; the number check compares the set of numbers, so swapped numbers pass (decimal points are kept, so 2.5 and 25 differ); results are shared per session and match, and a failed or paused attempt is retried by the next viewer. Clients must render `variants` as text, not HTML. **Planned:** deployment (the Container App sets no `TRANSLATOR_*` variables and holds no Translator role yet, so in the cloud the feature stays off), a client that reads `variants` (none does yet), the heartbeat-based active-viewer count (a stream with `lang` is the signal today), the `Translation paused` note, translating `/talk` replies, and per-language voices.

## 5. Broadcast desk script today (Simulated)
- The Broadcast desk (`apps/unified/embed/bclang.js`) writes Spanish and Hindi lines from fixed rules templates, not from Azure AI Translator (**Planned**, section 4). Each line passes the same numbers/names/order re-check as the shell; a failing line stays English and the script list shows the reason. The desk does not yet write `translation_rejected` to the audit chain, which only the shell does. The check does not judge meaning, so the Translator path must add a semantic check before it replaces the templates.
- The desk's Speak button uses the browser's `speechSynthesis` (es-ES, hi-IN) and is labelled as a simulated voice. This is the one exception to "synthesis runs in api"; it goes away when the Speech SDK path is wired.
- Tamil is out of the desk until a native speaker reviews it.
