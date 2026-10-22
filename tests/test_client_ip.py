"""Rate limits key on the caller's address: the forwarded header counts only behind the ingress."""

from types import SimpleNamespace

from app.matches import client_ip


def request(forwarded=None, peer="10.0.0.9"):
    headers = {"x-forwarded-for": forwarded} if forwarded is not None else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer) if peer else None)


def test_header_is_ignored_outside_the_ingress(monkeypatch):
    monkeypatch.delenv("MATCHCAST_BEHIND_INGRESS", raising=False)
    assert client_ip(request("1.2.3.4")) == "10.0.0.9"


def test_behind_the_ingress_the_rightmost_entry_wins(monkeypatch):
    monkeypatch.setenv("MATCHCAST_BEHIND_INGRESS", "true")
    assert client_ip(request("203.0.113.7")) == "203.0.113.7"


def test_spoofed_entries_on_the_left_are_ignored(monkeypatch):
    monkeypatch.setenv("MATCHCAST_BEHIND_INGRESS", "true")
    assert client_ip(request("6.6.6.6, 7.7.7.7, 203.0.113.7")) == "203.0.113.7"


def test_absent_or_empty_header_falls_back_to_the_peer(monkeypatch):
    monkeypatch.setenv("MATCHCAST_BEHIND_INGRESS", "true")
    assert client_ip(request()) == "10.0.0.9"
    assert client_ip(request("  ")) == "10.0.0.9"
    assert client_ip(request(peer=None)) == "local"


def test_port_suffix_trailing_comma_and_case_are_handled(monkeypatch):
    monkeypatch.setenv("MATCHCAST_BEHIND_INGRESS", " True ")
    assert client_ip(request("203.0.113.7:51234")) == "203.0.113.7"
    assert client_ip(request("[2001:db8::1]:443")) == "2001:db8::1"
    assert client_ip(request("203.0.113.7,")) == "203.0.113.7"


def test_a_non_address_falls_back_to_the_peer(monkeypatch):
    monkeypatch.setenv("MATCHCAST_BEHIND_INGRESS", "true")
    assert client_ip(request("not-an-ip")) == "10.0.0.9"
