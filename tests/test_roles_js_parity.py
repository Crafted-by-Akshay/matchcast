"""The browser role table (embed/roles.js) says what orders.py says (EXP-16)."""

import json
import re
from pathlib import Path

from matchcast_agents.roles.orders import _NEGATED, _RULES, CLEAR, GROUP_OF, GROUP_ORDERS

ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "apps/unified/embed/roles.js").read_text()
WATCH = (ROOT / "apps/unified/embed/watch.js").read_text()


def literal(name: str) -> dict:
    body = re.search(rf"const {name} = (\{{.*?\}});", JS, re.S).group(1)
    return json.loads(re.sub(r"(\w+):", r'"\1":', body.replace("'", '"')))


def test_groups_match() -> None:
    assert literal("MC_GROUP") == GROUP_OF


def test_orders_match() -> None:
    js = {g: sorted(v) for g, v in literal("MC_ORDERS").items()}
    py = {g: sorted(set(v) - {CLEAR}) for g, v in GROUP_ORDERS.items()}
    assert js == py


def test_the_rules_reading_matches_orders_py() -> None:
    # the Watch hook's keyword patterns are the same source text as orders.py, so they cannot drift
    block = re.search(r"const MC_RULES = \[(.*?)\];", WATCH, re.S).group(1)
    js_rules = dict(re.findall(r"\['(\w+)', /(.*?)/\]", block))
    py_rules = {key: pattern.pattern for key, pattern in _RULES}
    assert js_rules == py_rules
    js_negated = re.search(r"const MC_NEGATED = /(.*?)/;", WATCH).group(1)
    assert js_negated == _NEGATED.pattern
