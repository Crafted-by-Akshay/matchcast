"""Only the stateless web app scales out; the api holds per-match crew state and SSE in memory
(ADR-0005), so it stays at exactly one replica."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BICEP = (ROOT / "infra" / "modules" / "containerapps.bicep").read_text()


def scale_block(app: str) -> str:
    start = BICEP.index(f"resource {app} 'Microsoft.App/containerApps")
    nxt = BICEP.find("\nresource ", start + 1)
    body = BICEP[start : nxt if nxt != -1 else len(BICEP)]
    return body[body.index("scale: {") :]


def test_web_scales_out_to_three_on_http_load() -> None:
    block = scale_block("web")
    assert "maxReplicas: 3" in block
    assert "name: 'http', http: { metadata: { concurrentRequests: '50' } }" in block


def test_api_stays_on_exactly_one_replica() -> None:
    assert re.search(r"maxReplicas: 1\b", scale_block("api"))
