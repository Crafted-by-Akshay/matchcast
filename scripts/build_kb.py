"""Chunk kb/ into kb/build/<version>/chunks.jsonl (the fallback copy of the index).

``--upload`` also creates the AI Search index and uploads the chunks (keyword index; embeddings
are Planned until a model deployment exists). It needs ``SEARCH_ENDPOINT`` and ``SEARCH_ADMIN_KEY``
in the environment (the admin key lives in Key Vault as ``srch-admin-key``, ADR-0009) and runs on
the Mac mini or in CI; the offline half is what the tests use.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path

from matchcast_agents.ask import load_kb
from matchcast_agents.ask.azure_search import AzureSearchClient


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--kb", type=Path, default=Path("kb"))
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--upload", action="store_true", help="create the index and upload")
    args = parser.parse_args()
    out = args.out or args.kb / "build" / args.version / "chunks.jsonl"
    chunks = load_kb(args.kb, args.version)
    ids = [c.id for c in chunks]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate chunk ids")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(c.row(), ensure_ascii=False) + "\n" for c in chunks))
    print(f"{len(chunks)} chunks from {len({c.doc_id for c in chunks})} documents -> {out}")
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


if __name__ == "__main__":
    main()
