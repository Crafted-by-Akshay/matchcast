"""scripts/build_kb.py --dry-run plays the AI Search upload offline (AGT-16 task 145)."""

import asyncio
import importlib.util
from pathlib import Path

from matchcast_agents.ask import load_kb

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_kb", ROOT / "scripts" / "build_kb.py")
build_kb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_kb)


def test_dry_run_uploads_every_chunk_with_legal_keys_and_prunes_nothing() -> None:
    chunks = load_kb(ROOT / "kb")
    out = asyncio.run(build_kb.dry_run(chunks))
    assert out["would_upload"] == out["indexed"] == len(chunks)
    assert out["would_prune"] == 0
    assert out["largest_request_bytes"] < build_kb.MAX_BATCH_BYTES


def test_dry_run_rejects_an_illegal_key_like_the_service_does() -> None:
    from matchcast_agents.ask import azure_search

    original = azure_search.doc_key
    azure_search.doc_key = lambda chunk_id: chunk_id  # ids carry ':' which the service refuses
    try:
        import pytest

        with pytest.raises(azure_search.SearchError, match="not indexed"):
            asyncio.run(build_kb.dry_run(load_kb(ROOT / "kb")[:3]))
    finally:
        azure_search.doc_key = original
