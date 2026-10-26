"""Stream and ask with lang: checked variants only, English kept on any doubt (EXP-17)."""

import json

from app.main import create_app
from fastapi.testclient import TestClient
from matchcast_agents.translate import LANGUAGES, TranslationService
from test_api_matches import Q, ask, create, post_all


class Echo:
    """Stands in for the service: 'translates' by prefixing, leaving names and numbers alone."""

    def __init__(self, mangle=False):
        self.mangle = mangle

    def translate(self, text_html, lang):
        out = text_html.replace("1", "9") if self.mangle else text_html
        return f"[{lang}] {out}"


def make(translator) -> TestClient:
    app = create_app()
    app.state.matches.translation = TranslationService(translator, max_chars=100_000)
    return TestClient(app)


class Counting(Echo):
    """Echo that counts the calls, so a test can see whether a text was sent to translation."""

    def __init__(self):
        super().__init__()
        self.calls = 0

    def translate(self, text_html, lang):
        self.calls += 1
        return super().translate(text_html, lang)


def test_broadcast_picks_are_not_translated() -> None:
    """Broadcast picks are not translated: the desk reads answer.broadcast, not variants."""
    translator = Counting()
    client = make(translator)
    create(client)
    post_all(client)
    picked = ask(client, "What are the highlights so far?", surface="broadcast", lang="es").json()
    assert picked["broadcast"]["highlights"], picked
    assert "variants" not in picked and translator.calls == 0
    plain = ask(client, "How many shots has Northgate FC had so far?", lang="es").json()
    assert not plain["abstained"] and translator.calls > 0


def pubs(client, lang):
    response = client.get(
        "/v1/matches/match-short/stream",
        params={**Q, "persona": "casual", "follow": "false", "lang": lang},
    )
    assert response.status_code == 200
    frames = [f for f in response.text.split("\n\n") if f.startswith("event: publication")]
    return [json.loads(f.splitlines()[-1][6:]) for f in frames], response.text


def audit(client):
    return client.get("/v1/matches/match-short/audit", params=Q).json()["items"]


def test_spanish_viewer_gets_a_variant_and_english_stays_the_base():
    client = make(Echo())
    create(client)
    post_all(client)
    es, _ = pubs(client, "es")
    assert es and all(p["language"] == "en" and p["variants"]["es"].startswith("[es] ") for p in es)
    en, _ = pubs(client, "en")
    assert en and all("variants" not in p for p in en)


def test_every_feed_language_gets_a_checked_variant_and_english_gets_none():
    client = make(Echo())
    create(client)
    post_all(client)
    for lang in LANGUAGES:
        shown, _ = pubs(client, lang)
        assert shown, lang
        with_variant = [p for p in shown if "variants" in p]
        if lang == "en":
            assert not with_variant
        else:
            assert with_variant
            assert all(p["variants"][lang].startswith(f"[{lang}] ") for p in with_variant)


def test_a_translation_that_changes_a_number_is_dropped_and_audited():
    client = make(Echo(mangle=True))
    create(client)
    post_all(client)
    shown, _ = pubs(client, "hi")
    with_digit_one = [p for p in shown if "1" in p["text"]]
    assert with_digit_one and all("variants" not in p for p in with_digit_one)
    rejected = [r for r in audit(client) if r["action"] == "translation_rejected"]
    assert rejected and rejected[0]["details"]["language"] == "hi"


def test_unconfigured_service_serves_english_without_noise():
    client = make(None)
    create(client)
    post_all(client)
    shown, _ = pubs(client, "es")
    assert shown and all("variants" not in p for p in shown)
    assert not [r for r in audit(client) if r["action"] == "translation_rejected"]


def test_ask_takes_the_same_languages_as_the_stream():
    from typing import get_args

    from app.matches import AskBody

    assert get_args(AskBody.model_fields["lang"].annotation) == LANGUAGES
    client = make(Echo())
    create(client)
    post_all(client)
    for lang in LANGUAGES[1:]:
        assert ask(client, "What is offside?", lang=lang).status_code == 200, lang


def test_unsupported_language_is_refused():
    client = make(Echo())
    create(client)
    r = client.get("/v1/matches/match-short/stream", params={**Q, "lang": "ta", "follow": "false"})
    assert r.status_code == 422 and r.json()["code"] == "contract_invalid"


def test_ask_answer_is_translated_and_checked():
    client = make(Echo())
    create(client)
    post_all(client)
    reply = ask(client, "What is offside?", lang="es").json()
    assert reply["lang"] == "en" and reply["variants"]["es"].startswith("[es] ")
    assert "variants" not in ask(client, "What is offside?").json()
    assert ask(client, "What is offside?", lang="ta").status_code == 422


def test_catch_me_up_is_translated_and_checked():
    client = make(Echo())
    create(client)
    post_all(client)
    url = "/v1/matches/match-short/catch-me-up"
    body = client.get(url, params={**Q, "minute": 30, "lang": "es"}).json()
    assert body["text"].startswith("Score so far:")
    assert body["variants"]["es"].startswith("[es] Score so far:")
    assert "variants" not in client.get(url, params={**Q, "minute": 30}).json()


def test_catch_me_up_that_changes_a_number_is_dropped_and_audited():
    client = make(Echo(mangle=True))
    create(client)
    post_all(client)
    url = "/v1/matches/match-short/catch-me-up"
    body = client.get(url, params={**Q, "minute": 30, "lang": "hi"}).json()
    assert "variants" not in body and body["text"].startswith("Score so far:")
    rejected = [r for r in audit(client) if r["action"] == "translation_rejected"]
    assert rejected and rejected[0]["details"]["language"] == "hi"
