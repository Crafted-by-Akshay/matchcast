"""Send one short prompt to the Foundry model with Entra auth and print the result.

Needs FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL_DEPLOYMENT, plus `az login`.
Prints the model reply, token counts and latency. Never prints credentials.
"""

from __future__ import annotations

import os
import sys
import time

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential


def main() -> int:
    endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
    deployment = os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-6-luna")
    if not endpoint:
        print("FOUNDRY_PROJECT_ENDPOINT is not set", file=sys.stderr)
        return 2

    project = AIProjectClient(endpoint=endpoint, credential=DefaultAzureCredential())
    client = project.get_openai_client()
    started = time.perf_counter()
    reply = client.chat.completions.create(
        model=deployment,
        messages=[{"role": "user", "content": "Reply with the single word: ready"}],
        max_completion_tokens=16,
    )
    latency_ms = round((time.perf_counter() - started) * 1000)

    usage = reply.usage
    print(f"model: {reply.model}")
    print(f"reply: {reply.choices[0].message.content}")
    print(f"prompt_tokens: {usage.prompt_tokens if usage else 'n/a'}")
    print(f"completion_tokens: {usage.completion_tokens if usage else 'n/a'}")
    print(f"latency_ms: {latency_ms}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
