"""The api's spoken clips: commentary voices get a style and prosody; clips are keyed by markup."""

import hashlib

from app.voice import clip_key, ssml


def test_a_commentary_voice_gets_its_cheerful_style_and_prosody():
    markup = ssml("Goal! Ana (Ridgeview).", "en-GB-RyanNeural")
    assert "<mstts:express-as style='cheerful'>" in markup
    assert "<prosody rate='+0%' pitch='+3%'>Goal! Ana (Ridgeview).</prosody>" in markup
    assert "xmlns:mstts='https://www.w3.org/2001/mstts'" in markup


def test_the_second_commentary_voice_gets_cheerful_too():
    assert "<mstts:express-as style='cheerful'>" in ssml("Save!", "en-GB-SoniaNeural")


def test_a_voice_without_a_known_style_gets_the_prosody_only():
    markup = ssml("Gol de Ana.", "es-ES-ElviraNeural")
    assert "express-as" not in markup
    assert "<prosody rate='+0%' pitch='+3%'>Gol de Ana.</prosody>" in markup


def test_the_text_is_escaped_inside_the_markup():
    markup = ssml("Ana & <Ben>", "en-GB-SoniaNeural")
    assert "Ana &amp; &lt;Ben&gt;" in markup


def test_a_clip_made_before_the_markup_changed_is_not_reused():
    # the key holds the markup version: a plain clip cached under the old key is not served again
    old = hashlib.sha256("en-GB-RyanNeural\nSave!".encode()).hexdigest()[:32]
    assert clip_key("Save!", "en-GB-RyanNeural") != old
