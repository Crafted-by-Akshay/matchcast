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
    assert numbers("सात 7 शॉट, ७ और 2,5") == numbers("7 7 2.5") == ["2.5", "7", "7"]
    assert numbers("2.5 xG") != numbers("25 xG")


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
            *[service.variant("s/m", "p1", EN, "es", ["Northgate FC"]) for _ in range(5)]
        )

    results = run(go())
    assert len(fake.calls) == 1 and all(r.text == EN for r in results)


def test_unsupported_unconfigured_and_failing_service_keep_english():
    async def go(service, lang):
        return await service.variant("s/m", "p", EN, lang, [])

    assert run(go(TranslationService(Fake(), 100), "en")).reason == "unsupported"
    assert run(go(TranslationService(Fake(), 100), "ta")).reason == "unsupported"
    assert run(go(TranslationService(None, 100), "es")).reason == "unavailable"
    assert run(go(TranslationService(Fake(error=True), 100), "es")).reason == "service_error"


def test_a_changed_number_is_rejected_with_the_reason():
    service = TranslationService(Fake(lambda t: t.replace("7", "9")), 1000)
    v = run(service.variant("s/m", "p", EN, "es", ["Northgate FC"]))
    assert v.text is None and v.reason == "numbers_differ"


def test_character_cap_pauses_translation():
    service = TranslationService(Fake(), max_chars=len(EN))

    async def go():
        first = await service.variant("s/m", "a", EN, "es", [])
        second = await service.variant("s/m", "b", EN, "es", [])
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


def test_a_variant_is_never_served_to_another_match_or_other_names():
    fake = Fake(lambda t: "[es] " + t)

    async def go():
        service = TranslationService(fake, 10_000)
        one = await service.variant("a/m1", "p", "Zed has 3 shots", "es", ["Zed"])
        two = await service.variant("b/m2", "p", "Hugo has 3 shots", "es", ["Hugo"])
        return one, two

    one, two = run(go())
    assert len(fake.calls) == 2 and one.text != two.text


def test_one_viewer_leaving_does_not_cancel_the_others():
    import threading

    gate = threading.Event()

    class Slow(Fake):
        def translate(self, text_html, lang):
            gate.wait(2)
            return text_html

    async def go():
        service = TranslationService(Slow(), 10_000)
        first = asyncio.create_task(service.variant("s/m", "p", EN, "es", []))
        second = asyncio.create_task(service.variant("s/m", "p", EN, "es", []))
        await asyncio.sleep(0.05)
        first.cancel()
        gate.set()
        return await second

    assert run(go()).text == EN


def test_credential_errors_keep_english_and_are_retried_later():
    class Broken(Fake):
        def translate(self, text_html, lang):
            raise RuntimeError("no credential")

    async def go():
        service = TranslationService(Broken(), 10_000)
        first = await service.variant("s/m", "p", EN, "es", [])
        service.translator = Fake()
        second = await service.variant("s/m", "p", EN, "es", [])
        return first, second

    first, second = run(go())
    assert first.reason == "service_error" and second.text == EN


def test_a_rejection_is_audited_once_however_many_viewers_ask():
    seen = []
    service = TranslationService(Fake(lambda t: t.replace("7", "9")), 10_000)

    async def go():
        for _ in range(4):
            await service.variant("s/m", "p", EN, "es", [], seen.append)

    run(go())
    assert seen == ["numbers_differ"]


def test_the_feed_languages_are_the_ten_agreed_ones():
    from matchcast_agents.translate import LANGUAGES

    assert LANGUAGES == ("en", "es", "pt", "hi", "ar", "fr", "de", "id", "ja", "zh-Hans")


def test_arabic_indic_and_full_width_digits_are_compared_as_numbers():
    assert numbers("٧ تسديدات و ٢,٥ xG") == numbers("7 تسديدات و 2.5 xG") == ["2.5", "7"]
    assert numbers("７ shots") == ["7"]
    assert numbers("٧ و ٢٫٥") == numbers("7 و 2.5") == ["2.5", "7"]
    assert numbers("２．５ xG") == ["2.5"]


def test_a_translation_naming_a_competition_is_rejected():
    ja = "北方FCは7本のシュートと2.5 xGを記録、FIFAのルール [claim:c-1]"
    assert recheck(EN, ja, []) == "neutral_wording"
    assert recheck(EN, "北方FC有7次射门和2.5 xG，ＦＩＦＡ规则 [claim:c-1]", []) == "neutral_wording"
    assert recheck(EN, "北方FC有7次射门和2.5 xG，FIFA规则 [claim:c-1]", []) == "neutral_wording"
    assert recheck(EN, "Northgate FC tiene 7 tiros y 2,5 xG, la FIFA lo sabe [claim:c-1].", []) == (
        "neutral_wording"
    )
    assert recheck(EN, "Northgate FC tiene 7 tiros y 2,5 xG [claim:c-1].", []) is None
