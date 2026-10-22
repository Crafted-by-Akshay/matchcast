"""Knowledge-base ingestion and retrieval for the MatchCast Assistant (docs/architecture/05)."""

from .chunking import Chunk, chunk_document, load_kb
from .retrieval import Bm25Index, Hit

__all__ = ["Bm25Index", "Chunk", "Hit", "chunk_document", "load_kb"]
