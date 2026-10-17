"""JSON stdin/stdout bridge for cross-language contract checks; no provider calls."""

import json
import sys

from . import ContractError, validate


def main() -> None:
    try:
        entries = json.load(sys.stdin)
        result = [validate(entry["packet"], roster=entry.get("roster")) for entry in entries]
        print(json.dumps(result, allow_nan=False))
    except (ContractError, ValueError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
