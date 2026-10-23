"""Azure AI Search client for the knowledge base: schema, upload and keyword query (05 §4, §6).

AI Search Free has no managed identity (ADR-0009), so calls carry an ``api-key`` header: the query
key in the api, the admin key only in ``scripts/build_kb.py --upload``. Neither is logged or
returned. The vector field and hybrid query need an embeddings deployment and stay **Planned**;
until then the index is keyword-only, which 05 §7 documents as the no-quota behaviour.
"""

import os
import re
from collections.abc import Mapping
from typing import Any

import httpx

from .chunking import Chunk

API_VERSION = "2024-07-01"
DEFAULT_INDEX = "kb-matchcast-v1"
ENDPOINT = re.compile(r"^https://[a-z0-9-]+\.search\.windows\.net/?$")
BATCH = 500


class SearchError(Exception):
    """The search service failed or answered something unusable; callers fall back to BM25."""


def index_definition(name: str = DEFAULT_INDEX) -> dict[str, Any]:
    def text(field: str, **extra: Any) -> dict[str, Any]:
        return {"name": field, "type": "Edm.String", "searchable": True, **extra}

    def flat(field: str, **extra: Any) -> dict[str, Any]:
        return {"name": field, "type": "Edm.String", "searchable": False, **extra}

    return {
        "name": name,
        "fields": [
            flat("id", key=True, filterable=True),
            flat("corpus", filterable=True, facetable=True),
            flat("doc_id", filterable=True),
            text("title"),
            text("section"),
            text("text", analyzer="en.microsoft"),
            {
                "name": "entity_ids",
                "type": "Collection(Edm.String)",
                "searchable": False,
                "filterable": True,
            },
            flat("source_path"),
            flat("version", filterable=True),
        ],
    }


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def odata_filter(corpora: set[str] | None, entity_ids: set[str] | None) -> str | None:
    parts = []
    if corpora:
        parts.append("search.in(corpus, " + _quote(",".join(sorted(corpora))) + ")")
    if entity_ids:
        parts.append(
            "entity_ids/any(e: search.in(e, " + _quote(",".join(sorted(entity_ids))) + "))"
        )
    return " and ".join(parts) or None


class AzureSearchClient:
    def __init__(
        self,
        endpoint: str,
        key: str,
        index: str = DEFAULT_INDEX,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not ENDPOINT.match(endpoint.strip()):
            raise ValueError("SEARCH_ENDPOINT must be an https://<name>.search.windows.net host")
        self._base = endpoint.strip().rstrip("/")
        self._key = key
        self.index = index
        self._client = client or httpx.AsyncClient(timeout=5.0)

    async def _call(self, method: str, path: str, body: Any = None) -> dict[str, Any]:
        try:
            response = await self._client.request(
                method,
                f"{self._base}{path}",
                params={"api-version": API_VERSION},
                headers={"api-key": self._key},
                json=body,
            )
        except httpx.HTTPError as error:
            raise SearchError(f"search call failed: {type(error).__name__}") from error
        if response.status_code >= 400:
            raise SearchError(f"search answered {response.status_code}")
        try:
            return response.json() if response.content else {}
        except ValueError as error:
            raise SearchError("search answered something that is not JSON") from error

    async def ensure_index(self) -> None:
        await self._call("PUT", f"/indexes/{self.index}", index_definition(self.index))

    async def upload(self, chunks: list[Chunk]) -> int:
        """Merge-or-upload every chunk; ids are positional, so ``prune`` drops the stale ones."""
        for start in range(0, len(chunks), BATCH):
            rows = [
                {"@search.action": "mergeOrUpload", **c.row()}
                for c in chunks[start : start + BATCH]
            ]
            answer = await self._call("POST", f"/indexes/{self.index}/docs/index", {"value": rows})
            failed = [r for r in answer.get("value", []) if not r.get("status")]
            if failed:
                raise SearchError(f"{len(failed)} chunks were not indexed")
        return len(chunks)

    async def prune(self, keep: set[str]) -> int:
        """Delete indexed rows whose id is not in ``keep`` (a renumbered or removed chunk)."""
        stale: list[str] = []
        skip = 0
        while True:
            body = {"search": "*", "select": "id", "top": 1000, "skip": skip}
            rows = (await self._call("POST", f"/indexes/{self.index}/docs/search", body)).get(
                "value", []
            )
            stale += [r["id"] for r in rows if r["id"] not in keep]
            if len(rows) < 1000:
                break
            skip += 1000
        for start in range(0, len(stale), BATCH):
            batch = [{"@search.action": "delete", "id": i} for i in stale[start : start + BATCH]]
            await self._call("POST", f"/indexes/{self.index}/docs/index", {"value": batch})
        return len(stale)

    async def search(
        self,
        query: str,
        *,
        k: int = 5,
        corpora: set[str] | None = None,
        entity_ids: set[str] | None = None,
    ) -> list[tuple[str, float]]:
        """(chunk id, score) best first. Text is not returned: callers cite their own chunks."""
        body: dict[str, Any] = {
            "search": query,
            "queryType": "simple",
            "searchFields": "title,section,text",
            "select": "id",
            "top": k,
        }
        flt = odata_filter(corpora, entity_ids)
        if flt:
            body["filter"] = flt
        answer = await self._call("POST", f"/indexes/{self.index}/docs/search", body)
        try:
            return [(r["id"], float(r["@search.score"])) for r in answer["value"]]
        except (KeyError, TypeError, ValueError) as error:
            raise SearchError("search answered an unexpected shape") from error


def search_from_env(env: Mapping[str, str] | None = None) -> AzureSearchClient | None:
    """A client when the endpoint is a search host and a query key is set; else None (BM25 only)."""
    env = os.environ if env is None else env
    endpoint, key = env.get("SEARCH_ENDPOINT", "").strip(), env.get("SEARCH_QUERY_KEY", "")
    if not key or not ENDPOINT.match(endpoint):
        return None
    return AzureSearchClient(endpoint, key, env.get("SEARCH_INDEX") or DEFAULT_INDEX)
