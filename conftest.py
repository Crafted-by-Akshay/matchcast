"""No test may reach Azure: no real credential and no connection to a host outside this machine.

CLAUDE.md: no live Azure or Foundry call in PR checks. A test that needs a client gets a fake
(see docs/test-matrix.md). Mark a test `@pytest.mark.live` only for a run against a deployment.
"""

import ipaddress
import socket

import pytest

_LOOPBACK = {"localhost", "127.0.0.1", "::1", "testserver", "test"}


def _is_local(host: object) -> bool:
    if isinstance(host, bytes):
        host = host.decode()
    if not isinstance(host, str):
        return True  # unix sockets and the like
    if host in _LOOPBACK or host == "":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def pytest_configure(config):
    config.addinivalue_line("markers", "live: talks to a real deployment; skipped by the PR checks")


@pytest.fixture(autouse=True)
def no_azure(request, monkeypatch):
    monkeypatch.delenv("SPEECH_ENDPOINT", raising=False)  # no real voice from a developer shell
    if request.node.get_closest_marker("live"):
        return

    class NoTokens:
        """A client can be built with it; asking it for a token is a real call, so it fails."""

        def get_token(self, *_a, **_k):
            raise RuntimeError("this test tried to get an Azure token; give it a fake client")

        async def get_token_async(self, *_a, **_k):
            return self.get_token()

        async def close(self):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return None

    from matchcast_shared import azure_clients

    monkeypatch.setattr(azure_clients, "credential", lambda: NoTokens())
    monkeypatch.setattr(azure_clients, "credential_aio", lambda: NoTokens())

    real_connect = socket.socket.connect

    def guarded_connect(self, address):
        if isinstance(address, tuple) and not _is_local(address[0]):
            raise RuntimeError(f"this test tried to connect to {address[0]}; fake it instead")
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
