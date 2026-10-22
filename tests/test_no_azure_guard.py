"""The autouse guard in conftest.py stops a test from reaching Azure."""

import socket

import pytest
from matchcast_shared import azure_clients


def test_a_credential_cannot_get_a_token():
    with pytest.raises(RuntimeError, match="Azure token"):
        azure_clients.credential().get_token("https://ai.azure.com/.default")


def test_a_connection_to_another_host_is_refused():
    s = socket.socket()
    try:
        with pytest.raises(RuntimeError, match="fake it instead"):
            s.connect(("example.azure.com", 443))
    finally:
        s.close()


def test_loopback_still_works():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    client = socket.socket()
    try:
        client.connect(server.getsockname())
    finally:
        client.close()
        server.close()
