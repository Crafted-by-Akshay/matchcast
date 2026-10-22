"""Split the markdown knowledge base into stable, citable chunks (05-assistant-rag.md §3).

Sections split on H2 and H3. A chunk targets 350 tokens and never exceeds 500; the next chunk
repeats the last 50 tokens of the previous one. A table is never split. A "token" here is a
whitespace-separated word, which is close enough for sizing and keeps the build offline.
"""

import re
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

TARGET, MAX_TOKENS, OVERLAP = 350, 500, 50
_HEADING = re.compile(r"^(#{2,3})\s+(.*\S)\s*$")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Chunk:
    id: str
    corpus: str
    doc_id: str
    title: str
    section: str
    text: str
    entity_ids: tuple[str, ...] = field(default_factory=tuple)
    source_path: str = ""
    version: str = "v1"

    def row(self) -> dict[str, Any]:
        return {**asdict(self), "entity_ids": list(self.entity_ids)}


def tokens(text: str) -> int:
    return len(text.split())


def split_front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---\n"):
        return {}, raw
    end = raw.find("\n---\n", 4)
    if end == -1:
        return {}, raw
    meta = {}
    for line in raw[4:end].splitlines():
        key, _, value = line.partition(":")
        if value:
            meta[key.strip()] = value.strip()
    return meta, raw[end + 5 :]


def _blocks(body: str) -> Iterator[tuple[str, str]]:
    """Yield (section title, block) where a block is a paragraph or a whole table."""
    section = ""
    paragraph: list[str] = []
    table: list[str] = []

    def flush() -> Iterator[tuple[str, str]]:
        nonlocal paragraph, table
        if paragraph:
            yield section, " ".join(paragraph)
        if table:
            yield section, "\n".join(table)
        paragraph, table = [], []

    for line in body.splitlines():
        heading = _HEADING.match(line)
        if heading:
            yield from flush()
            section = heading.group(2)
        elif line.lstrip().startswith("|"):
            if paragraph:
                yield from flush()
            table.append(line.rstrip())
        elif not line.strip():
            yield from flush()
        else:
            if table:
                yield from flush()
            paragraph.append(line.strip())
    yield from flush()


def _split_long(block: str) -> list[str]:
    """A paragraph over the maximum is cut on sentence boundaries; tables stay whole."""
    if block.lstrip().startswith("|") or tokens(block) <= MAX_TOKENS:
        return [block]
    parts, current = [], ""
    for sentence in _SENTENCE.split(block):
        if current and tokens(current) + tokens(sentence) > TARGET:
            parts.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    return [*parts, current] if current else parts


def chunk_document(
    raw: str, *, corpus: str, slug: str, source_path: str = "", version: str = "v1"
) -> list[Chunk]:
    meta, body = split_front_matter(raw)
    title = meta.get("title") or slug.replace("-", " ").title()
    entities = tuple(e.strip() for e in meta.get("entities", "").split(",") if e.strip())
    groups: list[tuple[str, list[str]]] = []  # (section, blocks) in document order
    for section, block in _blocks(body):
        if not groups or groups[-1][0] != section:
            groups.append((section, []))
        groups[-1][1].extend(_split_long(block))
    chunks: list[Chunk] = []
    for section, blocks in groups:
        current: list[str] = []
        for block in blocks:
            size = sum(tokens(b) for b in current)
            if current and size + tokens(block) > TARGET:
                chunks.append(_make(chunks, current, corpus, slug, title, section, entities,
                                    source_path, version))  # fmt: skip
                tail = (
                    " ".join(current[-1].split()[-OVERLAP:]) if not _is_table(current[-1]) else ""
                )
                current = [f"…{tail}"] if tail else []
            current.append(block)
        if current:
            chunks.append(_make(chunks, current, corpus, slug, title, section, entities,
                                source_path, version))  # fmt: skip
    return chunks


def _is_table(block: str) -> bool:
    return block.lstrip().startswith("|")


def _make(
    done: list[Chunk],
    blocks: list[str],
    corpus: str,
    slug: str,
    title: str,
    section: str,
    entities: tuple[str, ...],
    source_path: str,
    version: str,
) -> Chunk:
    return Chunk(
        id=f"{corpus}:{slug}:{len(done) + 1}",
        corpus=corpus,
        doc_id=f"{corpus}:{slug}",
        title=title,
        section=section,
        text="\n\n".join(blocks),
        entity_ids=entities,
        source_path=source_path,
        version=version,
    )


def load_kb(root: Path, version: str = "v1") -> list[Chunk]:
    """Chunk every ``<root>/<corpus>/*.md``; ids are stable so re-ingestion updates in place."""
    chunks: list[Chunk] = []
    for path in sorted(root.glob("*/*.md")):
        raw = path.read_text(encoding="utf-8")
        rel = path.relative_to(root.parent).as_posix()
        chunks.extend(
            chunk_document(
                raw, corpus=path.parent.name, slug=path.stem, source_path=rel, version=version
            )
        )
    return chunks
