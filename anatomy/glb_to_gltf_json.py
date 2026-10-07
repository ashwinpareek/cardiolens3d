"""Write the GLB as a single self-contained .gltf JSON (buffer embedded as a data URI), saved with a
.json extension. Used for the static demo build (VITE_STATIC_DEMO=1) on hosts that only serve web media types.

    python anatomy/glb_to_gltf_json.py frontend/public/anatomy/heart_scene.glb frontend/public/anatomy/heart_scene.json
"""
import base64
import json
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
b = open(src, "rb").read()
_, _, length = struct.unpack("<4sII", b[:12])
off, js, binc = 12, None, None
while off < length:
    clen, ctype = struct.unpack("<II", b[off:off + 8])
    data = b[off + 8:off + 8 + clen]
    off += 8 + clen
    if ctype == 0x4E4F534A:
        js = json.loads(data)
    elif ctype == 0x004E4942:
        binc = data
js["buffers"][0]["uri"] = "data:application/octet-stream;base64," + base64.b64encode(binc).decode()
open(dst, "w").write(json.dumps(js, separators=(",", ":")))
