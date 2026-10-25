"""The Translator runs on the free tier (F0, 2M characters a month), so the feeds cost nothing."""

import re
from pathlib import Path

AI = Path(__file__).resolve().parents[1] / "infra" / "modules" / "ai.bicep"


def test_translator_is_free_tier() -> None:
    row = re.search(r"\{ key: 'translator', kind: 'TextTranslation'[^}]*\}", AI.read_text())
    assert row, "translator account row missing from ai.bicep"
    assert "sku: 'F0'" in row.group(0)
