"""Bundle the built app, its data and the 3D model into ONE self-contained HTML file (no server, no network).

    cd frontend && VITE_STATIC_DEMO=1 npx vite build --outDir /tmp/cl_build
    python scripts/make_single_html.py /tmp/cl_build <uncompressed heart_scene.glb> CardioLens3D.html

Use an uncompressed GLB (straight from anatomy/build_anatomy.py, before the meshopt step).
"""
import json, base64, glob, sys
B, glbpath, out, csp = sys.argv[1], sys.argv[2], sys.argv[3], (sys.argv[4] if len(sys.argv) > 4 else '')
import re
entry = re.search(r'src="\./(assets/[^"]+\.js)"', open(B + '/index.html').read()).group(1)
js = open(f'{B}/{entry}').read()
css = open(glob.glob(B + '/assets/*.css')[0]).read()
emb = {k: json.load(open(f'{B}/{k}')) for k in ['data/app_data.json', 'anatomy/registry.json', 'anatomy/centerlines.json']}
glb = base64.b64encode(open(glbpath, 'rb').read()).decode()
safe = lambda t: t.replace('</script', '<\\/script')
head = f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n' if csp else ''
html = f'''<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{head}<title>CardioLens 3D</title>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
<style>{css}
:root{{color-scheme:light}} html,body{{background:#f2f4f3}}</style>
<div id="root"><div style="padding:40px;font:15px system-ui;color:#3c4b55">Loading CardioLens 3D…</div></div>
<script>
window.__CL_EMBED__ = {safe(json.dumps(emb, separators=(',', ':')))};
(function () {{
  var b = atob("{glb}"); var u = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  window.__CL_EMBED__.glbBuffer = u.buffer;
}})();
</script>
<script type="module">{safe(js)}</script>
'''
open(out, 'w').write(html)
print(out, round(len(html) / 1e6, 2), 'MB')
