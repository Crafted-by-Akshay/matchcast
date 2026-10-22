"""Chunk kb/ into kb/build/<version>/chunks.jsonl (the fallback copy of the index).

Embedding and the upload to AI Search need the Azure resources and run on the Mac mini or in CI
with the OIDC identity (ADR-0009); this script is the offline half and is what the tests use.
"""

import argparse
import json
from pathlib import Path

from matchcast_agents.ask import load_kb


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--kb", type=Path, default=Path("kb"))
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    out = args.out or args.kb / "build" / args.version / "chunks.jsonl"
    chunks = load_kb(args.kb, args.version)
    ids = [c.id for c in chunks]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate chunk ids")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(c.row(), ensure_ascii=False) + "\n" for c in chunks))
    print(f"{len(chunks)} chunks from {len({c.doc_id for c in chunks})} documents -> {out}")


if __name__ == "__main__":
    main()
