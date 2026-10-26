# 15 Observability

Status: **Agreed design**. Last reviewed 22 Oct 2026. Backlog: PLT-8, EXP-6.

## 1. Signals

| Signal | Tool | What |
| --- | --- | --- |
| Traces | OpenTelemetry via `azure-monitor-opentelemetry` → App Insights | One trace per HTTP request and per workflow run |
| Metrics | App Insights custom metrics | Latency, tokens, verdict counts, fallback count, OCR calls, cost proxies |
| Logs | Structured JSON to stdout → Log Analytics | Errors and state changes; never prompts with user text at INFO |
| Audit | Table `audit` (product feature, not ops) | Every agent and person action, hash-chained |

## 2. Span names and attributes

Spans follow the OpenTelemetry GenAI conventions:

| Span | Attributes |
| --- | --- |
| `POST /v1/matches/{match_id}/events` | `matchcast.sk`, batch size, last_sequence |
| `consume match-events` | sequence, lag_ms |
| `invoke_agent producer|analyst|narrator|verifier` | `gen_ai.agent.name`, `matchcast.moment_id`, mode `live|rules` |
| `chat gpt-5-mini` | `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, finish reason |
| `execute_tool <tool>` | tool name, elapsed, result bytes |
| `verify` | `matchcast.line_id`, `matchcast.verdict`, `matchcast.reason_code` |
| `search kb` | top, hit count, fallback bool |
| `translate`, `synthesize`, `ocr` | language or voice, characters or bytes |

Trace context goes from the browser (`traceparent` header from `live.js`) through `api` to `mcp`, so one viewer action is one trace.

## 3. Dashboards and alerts

App Insights workbook `MatchCast agents`:
1. p50 and p95 latency per agent and end to end (event to publication).
2. Tokens per minute by agent.
3. Verdicts by reason code; abstentions; fallbacks.
4. Ask: hit rate, abstain rate, latency.
5. OCR calls a minute; translation characters; TTS characters.

| Alert | Condition | Action |
| --- | --- | --- |
| Agent latency | p95 event → publication > 6 s for 10 minutes | Check Foundry 429s; consider rules mode |
| Fallback spike | > 20% of lines from rules in 10 minutes | Check model health |
| Errors | 5xx > 5% for 5 minutes | Incident runbook |
| Budget | $40 and $50 (Cost Management) | Cost check, then shutdown steps |

## 4. Sampling and cost

100% sampling during the build. From 26 Oct, 25% for request spans, and 100% for spans with errors or verdict `rejected`. Daily cap 0.5 GB on Log Analytics.

## 5. Trace panel (in the product)

The trace panel shows the audit records plus a trace summary sent over SSE (agent, start, duration, model or rules, tokens, tools). The browser never queries App Insights.
