"""The player body packs are the biggest first-load asset; keep them slim (slim_players.py)."""

import base64
import gzip
import json
from pathlib import Path

PACKS = Path(__file__).resolve().parents[1] / "apps/unified/sources/3d-source/v2/players.json"
GZIP_BUDGET = 1_700_000  # bytes; was 2.64 MB before slimming


def test_packs_stay_under_the_gzip_budget():
    raw = PACKS.read_bytes()
    assert len(gzip.compress(raw, 6)) < GZIP_BUDGET


def test_packs_use_the_slim_attribute_types():
    for key, pack in json.loads(PACKS.read_bytes()).items():
        g = pack["gltf"]
        acc = g["accessors"]
        attrs = g["meshes"][0]["primitives"][0]["attributes"]
        assert acc[attrs["WEIGHTS_0"]]["componentType"] == 5121 and acc[attrs["WEIGHTS_0"]].get(
            "normalized"
        ), key
        assert acc[attrs["NORMAL"]]["componentType"] == 5120, key
        assert "KHR_mesh_quantization" in g.get("extensionsRequired", []), key
        assert len(base64.b64decode(pack["bin"])) == g["buffers"][0]["byteLength"], key


def test_packs_keep_their_layout_invariants():
    for key, pack in json.loads(PACKS.read_bytes()).items():
        g = pack["gltf"]
        buf = base64.b64decode(pack["bin"])
        prim = g["meshes"][0]["primitives"][0]
        assert all(v["byteOffset"] % 4 == 0 for v in g["bufferViews"]), key
        normal = g["accessors"][prim["attributes"]["NORMAL"]]
        assert g["bufferViews"][normal["bufferView"]].get("byteStride") == 4, key
        wa = g["accessors"][prim["attributes"]["WEIGHTS_0"]]
        wv = g["bufferViews"][wa["bufferView"]]
        w = buf[wv["byteOffset"] : wv["byteOffset"] + wv["byteLength"]]
        assert all(sum(w[i : i + 4]) == 255 for i in range(0, len(w), 4)), key
