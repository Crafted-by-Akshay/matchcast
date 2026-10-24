"""The browser role table (embed/roles.js) says what orders.py says (EXP-16)."""

import json
import re
from pathlib import Path

from matchcast_agents.roles.orders import CLEAR, GROUP_OF, GROUP_ORDERS

JS = (Path(__file__).resolve().parent.parent / "apps/unified/embed/roles.js").read_text()


def literal(name: str) -> dict:
    body = re.search(rf"const {name} = (\{{.*?\}});", JS, re.S).group(1)
    return json.loads(re.sub(r"(\w+):", r'"\1":', body.replace("'", '"')))


def test_groups_match() -> None:
    assert literal("MC_GROUP") == GROUP_OF


def test_orders_match() -> None:
    js = {g: sorted(v) for g, v in literal("MC_ORDERS").items()}
    py = {g: sorted(set(v) - {CLEAR}) for g, v in GROUP_ORDERS.items()}
    assert js == py
