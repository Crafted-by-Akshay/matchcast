"""Reading numbers out of a line's text, shared by the deterministic checks and the adversary."""

import re

EPSILON = 1e-9  # float noise: abs(0.35 - 0.34) is 0.010000000000000009
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w])")


def extract_numbers(text: str) -> list[float]:
    return [float(m) for m in _NUMBER.findall(text)]
