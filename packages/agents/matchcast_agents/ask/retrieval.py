"""In-memory BM25 over the chunks: the "Search fallback" path and the offline eval (05 §7)."""

import math
import re
from collections import Counter
from dataclasses import dataclass

from .chunking import Chunk

K1, B = 1.5, 0.75
_WORD = re.compile(r"[a-z0-9]+")
STOP = frozenset(
    "a an and are as at be by do does for from how in is it of on or that the this to was what "
    "when where which who why with".split()
)


def analyse(text: str) -> list[str]:
    """Lower-case words, stop words dropped, plural 's' and 'es' stripped."""
    words = []
    for word in _WORD.findall(text.lower()):
        if word in STOP:
            continue
        if len(word) > 4 and word.endswith("es"):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.append(word)
    return words


# Generated entity pages (clubs, players, season matches) only answer when the query names them,
# so "average xG" finds the metric page, not seven club records.
ENTITY_CORPORA = frozenset({"clubs", "players", "season"})


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float


class Bm25Index:
    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        # the title counts double so "xG" finds the xG page before a page that merely mentions it
        self._terms = [
            Counter(analyse(f"{c.title} {c.title} {c.section} {c.text}")) for c in chunks
        ]
        self._lengths = [sum(t.values()) for t in self._terms]
        self._avg = sum(self._lengths) / max(len(chunks), 1)
        frequency: Counter[str] = Counter()
        for terms in self._terms:
            frequency.update(terms.keys())
        n = len(chunks)
        self._title_words = [
            (set(analyse(c.title)) - {"season", "match"}) | set(analyse(" ".join(c.entity_ids)))
            if c.corpus in ENTITY_CORPORA
            else set()
            for c in chunks
        ]
        self._idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in frequency.items()}

    def search(
        self,
        query: str,
        *,
        k: int = 5,
        corpora: set[str] | None = None,
        entity_ids: set[str] | None = None,
    ) -> list[Hit]:
        words = analyse(query)
        named = set(words)
        hits = []
        for chunk, terms, length, title in zip(
            self.chunks, self._terms, self._lengths, self._title_words, strict=True
        ):
            if corpora and chunk.corpus not in corpora:
                continue
            if not corpora and not entity_ids and chunk.corpus in ENTITY_CORPORA:
                if not title & named:
                    continue
            if entity_ids and not entity_ids & set(chunk.entity_ids):
                continue
            score = 0.0
            for word in words:
                tf = terms.get(word, 0)
                if tf:
                    norm = tf + K1 * (1 - B + B * length / self._avg)
                    score += self._idf.get(word, 0.0) * tf * (K1 + 1) / norm
            if score > 0:
                hits.append(Hit(chunk, score))
        hits.sort(key=lambda h: (-h.score, h.chunk.id))
        return hits[:k]
