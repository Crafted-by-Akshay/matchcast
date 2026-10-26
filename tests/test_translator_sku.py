"""The Translator stays on S1: Azure policy blocks an in-place S1 to F0 change and stalls the deploy."""

import re
from pathlib import Path

AI = Path(__file__).resolve().parents[1] / "infra" / "modules" / "ai.bicep"


def test_translator_is_s1() -> None:
    row = re.search(r"\{ key: 'translator', kind: 'TextTranslation'[^}]*\}", AI.read_text())
    assert row, "translator account row missing from ai.bicep"
    assert "sku: 'S1'" in row.group(0)
