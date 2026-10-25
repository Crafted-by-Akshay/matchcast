"""The four player body packs are the biggest first-load asset; keep them slim (scripts/slim_players.py)."""
import base64
import gzip
import json
from pathlib import Path

PACKS = Path(__file__).resolve().parents[1] / "apps/unified/sources/3d-source/v2/players.json"
GZIP_BUDGET = 1_700_000   # bytes; was 2.64 MB before slimming


def test_packs_stay_under_the_gzip_budget():
    raw = PACKS.read_bytes()
    assert len(gzip.compress(raw, 6)) < GZIP_BUDGET


def test_packs_use_the_slim_attribute_types():
    for key, pack in json.loads(PACKS.read_bytes()).items():
        g = pack["gltf"]
        acc = g["accessors"]
        attrs = g["meshes"][0]["primitives"][0]["attributes"]
        assert acc[attrs["WEIGHTS_0"]]["componentType"] == 5121 and acc[attrs["WEIGHTS_0"]].get("normalized"), key
        assert acc[attrs["NORMAL"]]["componentType"] == 5120, key
        assert "KHR_mesh_quantization" in g.get("extensionsRequired", []), key
        assert len(base64.b64decode(pack["bin"])) == g["buffers"][0]["byteLength"], key
