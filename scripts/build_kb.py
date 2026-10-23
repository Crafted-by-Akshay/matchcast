"""Chunk kb/ into kb/build/<version>/chunks.jsonl (the fallback copy of the index).

``--upload`` also creates the AI Search index and uploads the chunks (keyword index; embeddings
are Planned until a model deployment exists). It needs ``SEARCH_ENDPOINT`` and ``SEARCH_ADMIN_KEY``
in the environment (the admin key lives in Key Vault as ``srch-admin-key``, ADR-0009) and runs on
the Mac mini or in CI; the offline half is what the tests use. ``--dry-run`` plays the whole upload
(index creation, batches, prune) against an in-memory stand-in for the service, so the payloads, key
rules and batch sizes are checked without credentials or a network.
"""

import argparse
import asyncio
import json
import os
import re
from pathlib import Path

import httpx
from matchcast_agents.ask import load_kb
from matchcast_agents.ask.azure_search import AzureSearchClient


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--kb", type=Path, default=Path("kb"))
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--upload", action="store_true", help="create the index and upload")
    parser.add_argument("--dry-run", action="store_true", help="play the upload offline")
    args = parser.parse_args()
    out = args.out or args.kb / "build" / args.version / "chunks.jsonl"
    chunks = load_kb(args.kb, args.version)
    ids = [c.id for c in chunks]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate chunk ids")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(c.row(), ensure_ascii=False) + "\n" for c in chunks))
    print(f"{len(chunks)} chunks from {len({c.doc_id for c in chunks})} documents -> {out}")
    if args.dry_run:
        print(json.dumps(asyncio.run(dry_run(chunks)), indent=2))
    if args.upload:
        endpoint, key = (
            os.environ.get("SEARCH_ENDPOINT", ""),
            os.environ.get("SEARCH_ADMIN_KEY", ""),
        )
        if not endpoint or not key:
            raise SystemExit(
                "--upload needs SEARCH_ENDPOINT and SEARCH_ADMIN_KEY in the environment"
            )
        asyncio.run(upload(AzureSearchClient(endpoint, key), chunks))


async def upload(client: AzureSearchClient, chunks: list) -> None:
    await client.ensure_index()
    sent = await client.upload(chunks)
    pruned = await client.prune({c.id for c in chunks})
    print(f"uploaded {sent} chunks to {client.index}, removed {pruned} stale")


KEY = re.compile(r"^[A-Za-z0-9_=-]+$")
MAX_BATCH_BYTES = 16 * 1024 * 1024  # AI Search limit for one indexing request


async def dry_run(chunks: list) -> dict:
    """Run ``upload`` against a stand-in service that enforces the rules the real one does."""
    seen: dict[str, int] = {"requests": 0, "documents": 0, "largest_request_bytes": 0}
    index: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["requests"] += 1
        seen["largest_request_bytes"] = max(seen["largest_request_bytes"], len(request.content))
        if len(request.content) > MAX_BATCH_BYTES:
            return httpx.Response(413)
        path = request.url.path
        if path.endswith("/docs/search"):
            rows = [{"key": k, "id": d["id"]} for k, d in sorted(index.items())]
            return httpx.Response(200, json={"value": rows})
        if path.endswith("/docs/index"):
            out = []
            for doc in json.loads(request.content)["value"]:
                ok = bool(KEY.match(doc["key"]))
                if ok and doc["@search.action"] == "delete":
                    index.pop(doc["key"], None)
                elif ok:
                    index[doc["key"]] = doc
                seen["documents"] += 1
                out.append({"key": doc["key"], "status": ok})
            return httpx.Response(200, json={"value": out})
        return httpx.Response(200 if "/indexes/" in path else 404, json={})

    client = AzureSearchClient(
        "https://dry-run.search.windows.net",
        "dry-run",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    await client.ensure_index()
    sent = await client.upload(chunks)
    pruned = await client.prune({c.id for c in chunks})
    return {"would_upload": sent, "would_prune": pruned, "indexed": len(index), **seen}


if __name__ == "__main__":
    main()
