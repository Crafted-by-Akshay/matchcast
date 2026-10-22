"""Short-lived Azure AI Speech tokens for the browser (EXP-16, docs/architecture/10).

The browser talks to Speech directly, so it needs a credential. It never gets a key: the api
exchanges its managed identity for a Microsoft Entra token and hands that over, shaped the way
the Speech SDK expects (`aad#<resource id>#<token>`). Without a Speech resource configured the
service says it is not ready and the browser keeps its text-only path.
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

SPEECH_PER_MINUTE = 10
SCOPE = "https://cognitiveservices.azure.com/.default"
REGION = re.compile(r"^[a-z0-9]{3,32}$")
RESOURCE_ID = re.compile(
    r"^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/[^/]+/accounts/[^/]+$"
)

log = logging.getLogger("matchcast.speech")


class SpeechError(Exception):
    """The token could not be issued; the message is safe to show."""


@dataclass(frozen=True)
class SpeechToken:
    token: str
    expires_at: float  # epoch seconds


Issuer = Callable[[], SpeechToken]


def _entra_issuer() -> SpeechToken:
    from azure.identity import DefaultAzureCredential

    access = DefaultAzureCredential().get_token(SCOPE)
    return SpeechToken(access.token, float(access.expires_on))


class SpeechTokenService:
    """Issues and caches one token per api process; refreshed a minute before it expires."""

    def __init__(
        self,
        resource_id: str | None = None,
        region: str | None = None,
        issuer: Issuer | None = None,
    ) -> None:
        env = os.environ.get
        self.resource_id = env("SPEECH_RESOURCE_ID") if resource_id is None else resource_id
        self.region = env("SPEECH_REGION") if region is None else region
        self._issuer = issuer or _entra_issuer
        self._cached: SpeechToken | None = None
        self.asked: dict[str, deque[float]] = {}

    @property
    def ready(self) -> bool:
        return bool(
            self.resource_id
            and self.region
            and RESOURCE_ID.match(self.resource_id)
            and REGION.match(self.region)
        )

    def allow(self, client: str, now: float | None = None) -> bool:
        """At most SPEECH_PER_MINUTE tokens per client address per rolling minute."""
        now = time.monotonic() if now is None else now
        for key in [k for k, w in self.asked.items() if not w or now - w[-1] >= 60]:
            del self.asked[key]
        window = self.asked.setdefault(client, deque())
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= SPEECH_PER_MINUTE:
            return False
        window.append(now)
        return True

    def issue(self, now: float | None = None) -> dict[str, object]:
        now = time.time() if now is None else now
        if not self.ready:
            raise SpeechError("no Speech resource is configured")
        if self._cached is None or self._cached.expires_at - now < 60:
            try:
                self._cached = self._issuer()
            except Exception as error:  # noqa: BLE001 - never leak credential errors to a browser
                log.warning("speech token not issued: %s", type(error).__name__)
                raise SpeechError("the Speech token could not be issued") from error
        token = self._cached
        return {
            "token": f"aad#{self.resource_id}#{token.token}",
            "region": self.region,
            "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(token.expires_at)),
        }
