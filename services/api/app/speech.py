"""Short-lived Azure AI Speech tokens for the browser (EXP-16, docs/architecture/10).

The browser talks to Speech directly, so it needs a credential. It never gets a key, and it never
gets the api's own Entra token either: that audience is shared by Foundry and Vision, so a leaked
one would reach them. Instead the api trades its managed identity for a Speech token at the
resource's `/sts/v1.0/issueToken`, which is good for ten minutes and for that one resource.
Without a Speech endpoint configured the service says it is not ready.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import urllib.request
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

SPEECH_PER_MINUTE = 10
SCOPE = "https://cognitiveservices.azure.com/.default"
TOKEN_SECONDS = 540  # the service issues 10 minutes; we hand it out for at most 9
REFRESH_MARGIN = 60
REGION = re.compile(r"^[a-z0-9]{3,32}$")
ENDPOINT = re.compile(r"^https://[a-z0-9-]{2,64}\.cognitiveservices\.azure\.com/?$")

log = logging.getLogger("matchcast.speech")


class SpeechError(Exception):
    """The token could not be issued; the message is safe to show."""


@dataclass(frozen=True)
class SpeechToken:
    token: str
    expires_at: float  # epoch seconds


Issuer = Callable[[], SpeechToken]


class _StsIssuer:
    """Entra bearer in, Speech-only token out. One credential, so azure-identity caches."""

    def __init__(self, endpoint: str) -> None:
        self.url = endpoint.rstrip("/") + "/sts/v1.0/issueToken"
        self._credential = None

    def __call__(self) -> SpeechToken:
        if self._credential is None:
            from azure.identity import DefaultAzureCredential

            self._credential = DefaultAzureCredential()
        bearer = self._credential.get_token(SCOPE).token
        request = urllib.request.Request(  # noqa: S310 - https, host checked by ENDPOINT
            self.url, data=b"", method="POST", headers={"Authorization": f"Bearer {bearer}"}
        )
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
            token = response.read().decode("ascii").strip()
        if not token:
            raise SpeechError("empty token")
        return SpeechToken(token, time.time() + TOKEN_SECONDS)


class SpeechTokenService:
    """Issues and caches one Speech token per api process, refreshed a minute before it lapses."""

    def __init__(
        self,
        endpoint: str | None = None,
        region: str | None = None,
        issuer: Issuer | None = None,
    ) -> None:
        env = os.environ.get
        self.endpoint = env("SPEECH_ENDPOINT") if endpoint is None else endpoint
        self.region = env("SPEECH_REGION") if region is None else region
        self._issuer = issuer
        self._cached: SpeechToken | None = None
        self._lock = threading.Lock()
        self.asked: dict[str, deque[float]] = {}

    @property
    def ready(self) -> bool:
        return bool(
            self.endpoint
            and self.region
            and ENDPOINT.match(self.endpoint)
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
        if not self.ready:
            raise SpeechError("no Speech resource is configured")
        with self._lock:  # one refresh at a time; the rest reuse its result
            now = time.time() if now is None else now
            if self._cached is None or self._cached.expires_at - now < REFRESH_MARGIN:
                if self._issuer is None:
                    self._issuer = _StsIssuer(self.endpoint)
                try:
                    self._cached = self._issuer()
                except Exception as error:  # noqa: BLE001 - never leak credential errors
                    log.warning("speech token not issued: %s", type(error).__name__)
                    raise SpeechError("the Speech token could not be issued") from error
            token = self._cached
        return {
            "token": token.token,
            "region": self.region,
            "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(token.expires_at)),
        }
