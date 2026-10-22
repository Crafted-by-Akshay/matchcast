"""Translate-then-verify: protect names, re-check numbers and names, cap characters (EXP-17)."""

import asyncio

from matchcast_agents.translate import (
    TranslationError,
    TranslationService,
    clean,
    numbers,
    protect,
    recheck,
)

EN = "Northgate FC have 7 shots and 2.5 xG [claim:c-1]."


def test_names_and_markers_are_wrapped_and_text_is_escaped():
    out = protect("A & B: Northgate FC 3 [claim:c-1]", ["Northgate FC"])
    assert out.count('translate="no"') == 2 and "&amp;" in out
    assert clean(out) == "A & B: Northgate FC 3 [claim:c-1]"


def test_numbers_read_devanagari_and_comma_decimals():
    assert numbers("सात 7 शॉट, ७ और 2,5") == numbers("7 7 25") == ["25", "7", "7"]


def test_recheck_accepts_faithful_and_rejects_each_kind_of_drift():
    names = ["Northgate FC"]
    assert recheck(EN, "Northgate FC tiene 7 tiros y 2,5 xG [claim:c-1].", names) is None
    assert recheck(EN, "", names) == "empty"
    assert (
        recheck(EN, "Northgate FC tiene 8 tiros y 2,5 xG [claim:c-1].", names) == "numbers_differ"
    )
    assert recheck(EN, "Nortegate tiene 7 tiros y 2,5 xG [claim:c-1].", names) == "name_changed"
    assert recheck(EN, "Northgate FC tiene 7 tiros y 2,5 xG [claim:c-9].", names) in (
        "numbers_differ",
        "citation_changed",
    )


class Fake:
    def __init__(self, reply=None, error=False):
        self.calls, self.reply, self.error = [], reply, error

    def translate(self, text_html, lang):
        self.calls.append((text_html, lang))
        if self.error:
            raise TranslationError("boom")
        return self.reply(text_html) if self.reply else text_html


def run(coro):
    return asyncio.run(coro)


def test_one_call_per_line_and_language_shared_by_concurrent_viewers():
    fake = Fake()

    async def go():
        service = TranslationService(fake, max_chars=1000)
        return await asyncio.gather(
            *[service.variant("p1", EN, "es", ["Northgate FC"]) for _ in range(5)]
        )

    results = run(go())
    assert len(fake.calls) == 1 and all(r.text == EN for r in results)


def test_unsupported_unconfigured_and_failing_service_keep_english():
    async def go(service, lang):
        return await service.variant("p", EN, lang, [])

    assert run(go(TranslationService(Fake(), 100), "en")).reason == "unsupported"
    assert run(go(TranslationService(Fake(), 100), "ta")).reason == "unsupported"
    assert run(go(TranslationService(None, 100), "es")).reason == "unavailable"
    assert run(go(TranslationService(Fake(error=True), 100), "es")).reason == "service_error"


def test_a_changed_number_is_rejected_with_the_reason():
    service = TranslationService(Fake(lambda t: t.replace("7", "9")), 1000)
    v = run(service.variant("p", EN, "es", ["Northgate FC"]))
    assert v.text is None and v.reason == "numbers_differ"


def test_character_cap_pauses_translation():
    service = TranslationService(Fake(), max_chars=len(EN))

    async def go():
        first = await service.variant("a", EN, "es", [])
        second = await service.variant("b", EN, "es", [])
        return first, second

    first, second = run(go())
    assert first.text == EN and second.reason == "paused" and service.paused


def test_azure_translator_posts_html_with_the_bearer_and_returns_the_text():
    import io
    import json
    from unittest import mock

    from matchcast_agents.translate import AzureTranslator

    endpoint = "https://matchcast-tr.cognitiveservices.azure.com/"
    translator = AzureTranslator(endpoint, "eastus2")
    translator._credential = mock.Mock(get_token=mock.Mock(return_value=mock.Mock(token="TOK")))
    body = json.dumps([{"translations": [{"text": "hola", "to": "es"}]}]).encode()
    response = mock.MagicMock()
    response.__enter__.return_value = io.BytesIO(body)
    with mock.patch("urllib.request.urlopen", return_value=response) as opened:
        assert translator.translate("<b>hi</b>", "es") == "hola"
    request = opened.call_args.args[0]
    assert request.full_url.startswith(endpoint + "translator/text/v3.0/translate?")
    assert "to=es" in request.full_url and "textType=html" in request.full_url
    assert request.get_header("Authorization") == "Bearer TOK"
    assert request.get_header("Ocp-apim-subscription-region") == "eastus2"
    assert json.loads(request.data) == [{"Text": "<b>hi</b>"}]


def test_azure_translator_failure_is_a_translation_error_without_detail():
    from unittest import mock

    import pytest
    from matchcast_agents.translate import AzureTranslator

    translator = AzureTranslator("https://x-tr.cognitiveservices.azure.com")
    translator._credential = mock.Mock(get_token=mock.Mock(return_value=mock.Mock(token="TOK")))
    with mock.patch("urllib.request.urlopen", side_effect=OSError("secret host")):
        with pytest.raises(TranslationError) as raised:
            translator.translate("x", "es")
    assert "secret" not in str(raised.value)
