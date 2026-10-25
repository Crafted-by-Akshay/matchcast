"""Knowledge-base ingestion, retrieval and the Assistant (docs/architecture/05)."""

import os
from functools import lru_cache
from pathlib import Path

from .assistant import AskResult, Assistant
from .azure_search import AzureSearchClient, SearchError, search_from_env
from .chunking import Chunk, chunk_document, load_kb
from .retrieval import Bm25Index, Hit

__all__ = [
    "AzureSearchClient",
    "SearchError",
    "search_from_env",
    "AskResult",
    "Assistant",
    "Bm25Index",
    "Chunk",
    "Hit",
    "chunk_document",
    "default_assistant",
    "load_kb",
]


def kb_root() -> Path:
    """The knowledge base folder: MATCHCAST_KB_DIR, else the repo's kb/."""
    root = os.environ.get("MATCHCAST_KB_DIR")
    if root is None:
        return next(p / "kb" for p in Path(__file__).resolve().parents if (p / "kb").is_dir())
    return Path(root)


@lru_cache(maxsize=1)
def default_assistant() -> Assistant:
    """The Assistant over the repo's kb/ (or MATCHCAST_KB_DIR), built once per process."""
    return Assistant(Bm25Index(load_kb(kb_root())), search_from_env())
