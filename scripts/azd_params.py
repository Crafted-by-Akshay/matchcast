#!/usr/bin/env python3
"""Render infra/main.parameters.json from an azd environment, the way `azd provision` does.

Usage: azd env get-values -e dev | scripts/azd_params.py infra/main.parameters.json > params.json

scripts/deploy_cloud.sh deploys main.bicep with `az deployment group create`, because
`azd provision` refuses to run without Docker when azure.yaml declares Docker services.
`${NAME}` and `${NAME=default}` are replaced from the env; an unset name without a default
stops the render.
"""

import json
import re
import sys

LINE = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"$')
REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?:=([^}]*))?\}")


def parse_env(text: str) -> dict[str, str]:
    env = {}
    for line in text.splitlines():
        match = LINE.match(line.strip())
        if match:
            env[match[1]] = re.sub(r"\\(.)", r"\1", match[2])
    return env


def render(template: str, env: dict[str, str]) -> dict:
    def value(match: re.Match) -> str:
        name, default = match[1], match[2]
        found = env.get(name, "")
        if not found and default is None:
            # azd would prompt for a parameter with no default; a deploy must not run without it
            sys.exit(f"{name} is not set in the azd env and has no default")
        return found if found else (default or "")

    # substitute inside the JSON strings, then parse, so a value cannot break the document
    doc = json.loads(template)
    for item in doc["parameters"].values():
        if isinstance(item.get("value"), str):
            item["value"] = REF.sub(value, item["value"])
    return doc


if __name__ == "__main__":
    template = open(sys.argv[1]).read()
    print(json.dumps(render(template, parse_env(sys.stdin.read())), indent=2))
