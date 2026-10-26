"""Captions on a talk reply (EXP-19): only a checked reply is translated, and no team is sent."""

import asyncio

from app.matches import captioned
from matchcast_agents.translate import TranslationService

REPLY = "Northgate FC have 7 shots."


class Fake:
    def translate(self, text_html: str, lang: str) -> str:
        return text_html.replace("have", "tiene")


def test_a_verified_reply_gets_its_transcript_and_caption_and_no_team():
    service = TranslationService(Fake(), 1000)
    result = {"verdict": "verified", "reply": REPLY, "team": "Brazil", "facts": {"shots": 7}}
    out = asyncio.run(captioned(service, "m1", result, "es"))
    assert "team" not in out
    assert out["captions"]["transcript"]["lang"] == "pt"
    assert out["captions"]["caption"] == {"lang": "es", "text": "Northgate FC tiene 7 shots."}


def test_a_rejected_reply_is_never_translated_or_captioned():
    service = TranslationService(Fake(), 1000)
    result = {
        "verdict": "rejected",
        "reply": "I can't confirm that.",
        "team": "Brazil",
        "facts": {},
    }
    out = asyncio.run(captioned(service, "m1", result, "es"))
    assert "captions" not in out and "team" not in out
    assert service.used == 0
