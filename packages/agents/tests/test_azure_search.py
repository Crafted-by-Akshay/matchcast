"""Azure AI Search client and its use by the Assistant (AGT-16); HTTP runs over a fake transport."""

import json
import re
from pathlib import Path

import httpx
import pytest
from conftest import run
from matchcast_agents.ask import Assistant, Bm25Index, load_kb
from matchcast_agents.ask.azure_search import (
    AzureSearchClient,
    SearchError,
    doc_key,
    index_definition,
    odata_filter,
    plain_terms,
    search_from_env,
)

KB = Path(__file__).parents[3] / "kb"
HOST = "https://srch-x.search.windows.net"


def client(handler) -> AzureSearchClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return AzureSearchClient(HOST, "secret-key", client=http)


def test_endpoint_must_be_a_search_host_and_needs_a_key() -> None:
    with pytest.raises(ValueError):
        AzureSearchClient("https://evil.example.com", "k")
    assert search_from_env({}) is None
    assert search_from_env({"SEARCH_ENDPOINT": HOST}) is None
    assert (
        search_from_env({"SEARCH_ENDPOINT": "https://evil.example", "SEARCH_QUERY_KEY": "k"})
        is None
    )
    assert search_from_env({"SEARCH_ENDPOINT": HOST, "SEARCH_QUERY_KEY": "k"}) is not None


def test_index_schema_matches_the_doc_and_filters_quote_values() -> None:
    names = [f["name"] for f in index_definition()["fields"]]
    assert names[:4] == ["key", "id", "corpus", "doc_id"] and names[-3:] == [
        "entity_ids",
        "source_path",
        "version",
    ]
    assert odata_filter(None, None) is None
    assert "o''x" in odata_filter({"o'x"}, None)


def test_search_sends_the_key_and_returns_ids_with_scores() -> None:
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, request.headers["api-key"], json.loads(request.content)))
        return httpx.Response(200, json={"value": [{"id": "a", "@search.score": 3.5}]})

    got = run(client(handler).search("xg", k=3, corpora={"metrics"}))
    assert got == [("a", 3.5)]
    path, key, body = seen[0]
    assert path.endswith("/docs/search") and key == "secret-key"
    assert body["top"] == 3 and "metrics" in body["filter"] and body["select"] == "id"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        httpx.Response(200, json={"oops": 1}),
        httpx.Response(200, text="<html>"),
    ],
)
def test_bad_answers_raise_search_error(response) -> None:
    with pytest.raises(SearchError):
        run(client(lambda r: response).search("xg"))


def test_upload_sends_every_chunk_and_prune_deletes_only_stale_ids() -> None:
    chunks = load_kb(KB)[:3]
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append((request.url.path, body))
        if request.url.path.endswith("/docs/search"):
            rows = [
                {"key": doc_key(chunks[0].id), "id": chunks[0].id},
                {"key": "k-gone", "id": "gone"},
            ]
            return httpx.Response(200, json={"value": rows})
        return httpx.Response(200, json={"value": [{"status": True}] * len(body.get("value", []))})

    c = client(handler)
    assert run(c.upload(chunks)) == 3
    assert run(c.prune({chunks[0].id})) == 1
    upload = calls[0][1]["value"]
    assert [r["id"] for r in upload] == [x.id for x in chunks]
    assert all(re.fullmatch(r"[A-Za-z0-9_=-]+", r["key"]) for r in upload)  # ':' is not a legal key
    assert all(r["@search.action"] == "mergeOrUpload" for r in upload)
    deletes = calls[-1][1]["value"]
    assert deletes == [{"@search.action": "delete", "key": "k-gone"}]


def test_a_failed_batch_item_is_reported() -> None:
    chunks = load_kb(KB)[:2]
    c = client(lambda r: httpx.Response(200, json={"value": [{"status": False}, {"status": True}]}))
    with pytest.raises(SearchError):
        run(c.upload(chunks))


class FakeRemote:
    def __init__(self, ids=None, fail=False) -> None:
        self.ids, self.fail = ids or [], fail

    async def search(self, query, **_kw):
        if self.fail:
            raise SearchError("down")
        return [(i, 1.0) for i in self.ids]


@pytest.fixture(scope="module")
def index():
    return Bm25Index(load_kb(KB))


def test_remote_ranks_but_local_score_still_gates(index) -> None:
    local = index.search("How is xG worked out?", k=5)
    assert len(local) >= 2
    reordered = [local[1].chunk.id, local[0].chunk.id, "not-in-the-kb"]
    hits, source = run(Assistant(index, FakeRemote(reordered))._retrieve("How is xG worked out?"))
    assert source == "search"
    assert [h.chunk.id for h in hits] == [local[1].chunk.id, local[0].chunk.id]
    none, source = run(
        Assistant(index, FakeRemote(["not-in-the-kb"]))._retrieve("How is xG worked out?")
    )
    assert source == "search_fallback" and none


def test_a_failing_search_falls_back_to_bm25_and_says_so(index, make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    result = run(
        Assistant(index, FakeRemote(fail=True)).ask(flow, "How is xG worked out?", "casual")
    )
    assert result.retrieval == "search_fallback" and not result.abstained
    assert result.citations and result.citations[0]["id"].startswith("metrics:xg")
    plain = run(Assistant(index).ask(flow, "How is xG worked out?", "casual"))
    assert plain.retrieval == "local" and plain.answer == result.answer


def test_user_text_cannot_use_search_operators_and_hosts_are_case_insensitive() -> None:
    assert plain_terms('non-penalty "xG" *') == "non penalty xG"
    assert AzureSearchClient("https://SRCH-X.search.windows.net", "k")._base == HOST


def test_an_empty_index_falls_back_to_bm25_and_is_counted(index) -> None:
    assistant = Assistant(index, FakeRemote(["not-in-the-kb"]))
    hits, source = run(assistant._retrieve("How is xG worked out?"))
    assert source == "search_fallback" and hits and assistant.search_fallbacks == 1


def test_a_below_threshold_hit_never_ends_the_list_early(index) -> None:
    query = "How is xG worked out?"
    local = index.search(query, k=50)
    weak = next(h for h in local if h.score < 2.2)
    best = local[0]
    hits, _ = run(Assistant(index, FakeRemote([weak.chunk.id, best.chunk.id]))._retrieve(query))
    assert [h.chunk.id for h in hits] == [best.chunk.id]


def test_a_failed_search_is_counted_and_never_leaks_the_key() -> None:
    with pytest.raises(SearchError) as error:
        run(client(lambda r: httpx.Response(401)).search("xg"))
    assert "secret-key" not in str(error.value)


def test_search_honours_corpus_and_top_and_reports_the_source(index) -> None:
    class Recording(FakeRemote):
        seen = None

        async def search(self, query, **kw):
            Recording.seen = kw
            return await super().search(query, **kw)

    laws = index.search("offside", k=50, corpora={"laws"})
    remote = Recording([h.chunk.id for h in reversed(laws[:3])])
    hits, source = run(Assistant(index, remote).search("offside", top=2, corpus="laws"))
    assert source == "search" and len(hits) == 2 and Recording.seen["corpora"] == {"laws"}
    assert all(h.chunk.corpus == "laws" for h in hits)
    hits, source = run(Assistant(index, None).search("offside", top=2, corpus="laws"))
    assert source == "local" and len(hits) == 2
