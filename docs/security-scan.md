# Security scan log

Dependency and secret scans for QUA-7. Each row is one run; fix or document every finding.

## 22 Oct 2026, main f65b75d (run locally; Actions down)

| Scan | Command | Result |
| --- | --- | --- |
| npm production dependencies | `npm audit --omit=dev` | 0 vulnerabilities |
| Python dependencies | `uv export --all-packages --no-hashes --no-emit-workspace` then `uvx pip-audit -r … --no-deps --disable-pip` | 3 packages with advisories (below) |
| Secrets | `gitleaks` | Not run here (binary not available on this machine); CI `secrets` job and `scripts/local_ci.sh secrets` cover it once Actions or gitleaks is back |

### Python findings

| Package | Version | Advisories | Fixed in | Runtime? | Action |
| --- | --- | --- | --- | --- | --- |
| starlette | 0.48.0 | PYSEC-2026-161, -1942, -2280, -2281, -248, -249 | 0.49.1 to 1.3.1 depending on the advisory | Yes (api, through FastAPI) | Agents lane: raise FastAPI/Starlette in `services/api` and re-run `make test`; if a pin blocks it, record why here |
| certifi | 2026.7.22 | PYSEC-2026-4320 | 2026.10.19 | Yes (HTTPS clients) | `uv lock --upgrade-package certifi` |
| pytest | 8.4.2 | PYSEC-2026-1845 | 9.0.3 | No (dev only) | Upgrade when convenient; not shipped in images |

The advisory text was not read in detail; severity and exploitability against our routes still need a human or reviewer pass before we call these fixed or accepted.

## 22 Oct 2026, main 3e35e1c (run locally; Actions down)

Same commands as above after #114 (FastAPI 0.129, certifi bump).

| Package | Version | Result |
| --- | --- | --- |
| certifi | 2026.10.19 | Fixed (PYSEC-2026-4320 no longer reported) |
| starlette | 0.52.1 | Still reported: PYSEC-2026-161 (fixed in 1.0.1), -2280 and -2281 (1.1.0), -248 (1.3.0), -249 (1.3.1). Every fix is in Starlette 1.x, which FastAPI 0.129 (`fastapi>=0.120,<0.130` in `services/api`) does not allow. Not fixed; accepted for the hackathon demo only after the advisory text is read against our routes (still open, see the note above). |
| pytest | 8.4.2 | Dev only, not shipped; unchanged |

To close the starlette findings, move `services/api` to a FastAPI release that supports Starlette 1.x and re-run `make test` and `make openapi-generate`.
