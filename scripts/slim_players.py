"""Slim players.json (four skinned body packs, glTF plus base64 bin) without changing its shape.

Same {A..D: {gltf, bin}} layout and the same loader (glbFrom + GLTFLoader), so no app code changes:
  WEIGHTS_0   float32 to uint8 normalized (re-normalised to sum 255):
              241 KB to 60 KB per pack
  COLOR_0     uint16 normalized to uint8 normalized: 121 KB to 60 KB
  TEXCOORD_0  float32 to uint16 normalized when every UV is inside [0, 1]:
              121 KB to 60 KB
  NORMAL      float32 to int8 normalized, 4-byte stride (KHR_mesh_quantization,
              which GLTFLoader reads): 181 KB to 60 KB
  POSITION    stays float32 (skinned meshes ignore node transforms, so there is no
              dequantisation matrix) but loses its low mantissa bits (about 0.5 mm
              on a 1.8 m body), which gzip then removes
Idempotent: a pack that is already slim is left alone.
Usage: python scripts/slim_players.py IN.json OUT.json
"""

import base64
import json
import sys

import numpy as np

F32, U16, U8 = 5126, 5123, 5121
POS_DROP = 12  # mantissa bits zeroed (of 23): error under 0.5 mm on a 1.8 m body


def truncate(a, bits):
    u = a.astype(np.float32).view(np.uint32)
    return (u & ~np.uint32((1 << bits) - 1)).view(np.float32)


def slim_pack(pack):
    g, buf = pack["gltf"], bytearray(base64.b64decode(pack["bin"]))
    prim = g["meshes"][0]["primitives"][0]
    acc, views = g["accessors"], g["bufferViews"]

    def raw(ai):
        a = acc[ai]
        v = views[a["bufferView"]]
        return a, np.frombuffer(
            bytes(buf[v["byteOffset"] : v["byteOffset"] + v["byteLength"]]), dtype=np.uint8
        )

    new, strides = {}, {}
    a, r = raw(prim["attributes"]["WEIGHTS_0"])
    if a["componentType"] == F32:
        w = r.view(np.float32).reshape(-1, 4)
        q = np.round(w / np.maximum(w.sum(1, keepdims=True), 1e-9) * 255).astype(np.int32)
        q[np.arange(len(q)), q.argmax(1)] += 255 - q.sum(1)
        new[prim["attributes"]["WEIGHTS_0"]] = (U8, True, q.astype(np.uint8).tobytes())
    a, r = raw(prim["attributes"]["COLOR_0"])
    if a["componentType"] == U16:
        new[prim["attributes"]["COLOR_0"]] = (
            U8,
            True,
            np.round(r.view(np.uint16) / 257).astype(np.uint8).tobytes(),
        )
    a, r = raw(prim["attributes"]["TEXCOORD_0"])
    if a["componentType"] == F32:
        uv = r.view(np.float32)
        if uv.min() >= 0 and uv.max() <= 1:
            new[prim["attributes"]["TEXCOORD_0"]] = (
                U16,
                True,
                np.round(uv * 65535).astype(np.uint16).tobytes(),
            )
    ai = prim["attributes"]["POSITION"]
    a, r = raw(ai)
    t = truncate(r.view(np.float32), POS_DROP)
    new[ai] = (F32, False, t.tobytes())
    p = t.reshape(-1, 3)
    a["min"], a["max"] = [float(x) for x in p.min(0)], [float(x) for x in p.max(0)]
    ai = prim["attributes"]["NORMAL"]
    a, r = raw(ai)
    if a["componentType"] == F32:
        n = r.view(np.float32).reshape(-1, 3)
        q = np.zeros((len(n), 4), np.int8)
        q[:, :3] = np.clip(np.round(n * 127), -127, 127)
        new[ai] = (5120, True, q.tobytes())
        strides[a["bufferView"]] = 4
    out = bytearray()
    order = sorted(range(len(views)), key=lambda i: views[i]["byteOffset"])
    for vi in order:
        v = views[vi]
        ai = next((i for i, x in enumerate(acc) if x["bufferView"] == vi), None)
        data = (
            new[ai][2]
            if ai in new
            else bytes(buf[v["byteOffset"] : v["byteOffset"] + v["byteLength"]])
        )
        while len(out) % 4:
            out.append(0)
        v["byteOffset"], v["byteLength"] = len(out), len(data)
        if vi in strides:
            v["byteStride"] = strides[vi]
        out += data
        if ai in new:
            acc[ai]["componentType"] = new[ai][0]
            if new[ai][1]:
                acc[ai]["normalized"] = True
            else:
                acc[ai].pop("normalized", None)
    while len(out) % 4:
        out.append(0)
    g["buffers"][0]["byteLength"] = len(out)
    if strides:
        for key in ("extensionsUsed", "extensionsRequired"):
            g.setdefault(key, [])
            if "KHR_mesh_quantization" not in g[key]:
                g[key].append("KHR_mesh_quantization")
    return {"gltf": g, "bin": base64.b64encode(bytes(out)).decode()}


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    packs = json.load(open(src))
    json.dump({k: slim_pack(v) for k, v in packs.items()}, open(dst, "w"), separators=(",", ":"))
