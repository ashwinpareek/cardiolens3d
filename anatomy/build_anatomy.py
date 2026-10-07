"""Build the web-ready anatomical scene from BodyParts3D (CC BY-SA 2.1 JP).

Pipeline
  1. Load the selected BodyParts3D STL parts (FMA ids, see anatomy_registry.json)
  2. Clean (drop tiny fragments), crop (skin -> thorax), quadric-decimate to a triangle budget
  3. Re-orient into a Y-up, anterior-facing (+Z), heart-centred frame, scale mm -> scene units
  4. Compute myocardial perfusion-territory weights per heart-wall vertex (soft nearest-vessel
     assignment to the LAD / LCX / RCA trees) and store them in the COLOR_0 attribute
  5. Extract vessel centrelines (voxelise -> 3D skeleton -> graph -> ostium-rooted paths)
     for the flow-particle animation
  6. Export   frontend/public/anatomy/heart_scene.glb   (named nodes, extras carry FMA id + target)
              frontend/public/anatomy/centerlines.json

Usage: python build_anatomy.py --stl <BodyParts3D stl dir>
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import networkx as nx
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REGISTRY = json.loads((HERE / "anatomy_registry.json").read_text())
OUT_DIR = ROOT / "frontend" / "public" / "anatomy"

SCALE = 0.01  # mm -> scene units (1 unit = 10 cm)


def to_scene(v: np.ndarray, centre: np.ndarray) -> np.ndarray:
    """BodyParts3D (x: patient-left+, y: posterior+, z: superior+) -> three.js (Y-up, anterior = +Z)."""
    c = v - centre
    return np.stack([c[:, 0], c[:, 2], -c[:, 1]], axis=1) * SCALE


def load_part(stl_dir: Path, fma: str) -> trimesh.Trimesh:
    m = trimesh.load(stl_dir / f"{fma}.stl", force="mesh")
    m.merge_vertices()
    return m


def clean(m: trimesh.Trimesh, min_frac=0.002) -> trimesh.Trimesh:
    parts = m.split(only_watertight=False)
    if len(parts) <= 1:
        return m
    total = sum(p.area for p in parts)
    keep = [p for p in parts if p.area >= min_frac * total]
    return trimesh.util.concatenate(keep)


def decimate(m: trimesh.Trimesh, faces: int) -> trimesh.Trimesh:
    if len(m.faces) <= faces:
        return m
    d = m.simplify_quadric_decimation(face_count=faces)
    d.merge_vertices()
    return d


def crop_z(m: trimesh.Trimesh, zmin, zmax) -> trimesh.Trimesh:
    keep = np.all((m.vertices[m.faces][:, :, 2] >= zmin) & (m.vertices[m.faces][:, :, 2] <= zmax), axis=1)
    m = m.submesh([np.where(keep)[0]], append=True)
    return m


# --------------------------------------------------------------------------- centrelines
def centerline_paths(mesh_mm: trimesh.Trimesh, parent_tree: cKDTree, pitch=0.6, min_len_mm=6.0):
    """Return list of polylines (mm) from the proximal end of the vessel tree to each distal tip."""
    vox = mesh_mm.voxelized(pitch).fill()
    mat = vox.matrix.astype(bool)
    skel = skeletonize(mat)
    idx = np.argwhere(skel)
    if len(idx) < 2:
        return []
    pts = vox.indices_to_points(idx)
    G = nx.Graph()
    lut = {tuple(i): k for k, i in enumerate(idx)}
    offs = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    for k, i in enumerate(idx):
        G.add_node(k)
        for o in offs:
            j = lut.get((i[0] + o[0], i[1] + o[1], i[2] + o[2]))
            if j is not None and j > k:
                G.add_edge(k, j, weight=float(np.linalg.norm(pts[k] - pts[j])))
    paths = []
    for comp in nx.connected_components(G):
        comp = list(comp)
        if len(comp) < 4:
            continue
        sub = G.subgraph(comp)
        cp = pts[comp]
        root = comp[int(np.argmin(parent_tree.query(cp)[0]))]
        dist, route = nx.single_source_dijkstra(sub, root)
        leaves = [n for n in sub.nodes if sub.degree(n) == 1 and n != root]
        # keep leaves that are far from root; prune short spurs by requiring the leaf's
        # path to add >= min_len beyond its branch point
        leaves.sort(key=lambda n: -dist[n])
        covered = set()
        for leaf in leaves:
            r = route[leaf]
            new = [n for n in r if n not in covered]
            new_len = sum(G[a][b]["weight"] for a, b in zip(new[:-1], new[1:])) if len(new) > 1 else 0
            if new_len < min_len_mm:
                continue
            covered.update(r)
            paths.append(pts[r])
    # light smoothing + resampling every ~1 mm
    out = []
    for p in paths:
        if len(p) < 3:
            continue
        k = np.ones(5) / 5
        sm = np.stack([np.convolve(np.pad(p[:, d], 2, mode="edge"), k, mode="valid") for d in range(3)], 1)
        seg = np.linalg.norm(np.diff(sm, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        n = max(4, int(s[-1] / 1.0))
        t = np.linspace(0, s[-1], n)
        out.append(np.stack([np.interp(t, s, sm[:, d]) for d in range(3)], 1))
    return out


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stl", required=True, type=Path)
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    parts = REGISTRY["parts"]
    raw = {}
    for p in parts:
        for fma in p["fma"]:
            raw[fma] = load_part(a.stl, fma)

    wall = raw["FMA7274"]
    centre = wall.bounds.mean(axis=0)

    scene = trimesh.Scene()
    vessel_mm = defaultdict(list)
    part_mm = {}
    stats = {}
    for p in parts:
        ms = [raw[f] for f in p["fma"]]
        m = trimesh.util.concatenate(ms) if len(ms) > 1 else ms[0].copy()
        if p.get("clean"):
            m = clean(m, p.get("clean_frac", 0.002))
        if "crop_z" in p:
            m = crop_z(m, *p["crop_z"])
        part_mm[p["id"]] = m.copy()
        if p.get("target"):
            vessel_mm[p["target"]].append(m.copy())
        m = decimate(m, p["faces"])
        m.vertices = to_scene(m.vertices, centre)
        m.fix_normals()
        m.visual = trimesh.visual.ColorVisuals(m)
        extras = {k: p[k] for k in ("id", "label", "group", "target", "fma", "description") if k in p}
        if p["id"] == "heart_wall":
            heart_wall_scene = m
        else:
            scene.add_geometry(m, node_name=p["id"], geom_name=p["id"], metadata=extras)
        stats[p["id"]] = len(m.faces)

    # ---- perfusion-territory weights on the myocardium (soft nearest-vessel assignment)
    terr_ids = REGISTRY["territory_targets"]  # ["LAD", "LCX", "RCA"]
    trees = {}
    for t in terr_ids:
        vm = trimesh.util.concatenate(vessel_mm[t])
        pts = to_scene(vm.sample(20000), centre)
        trees[t] = cKDTree(pts)
    V = heart_wall_scene.vertices
    D = np.stack([trees[t].query(V)[0] for t in terr_ids], 1)  # scene units
    sigma = 0.06  # ~6 mm softness
    W = np.exp(-(D - D.min(1, keepdims=True)) / sigma)
    W /= W.sum(1, keepdims=True)
    # fade territory tint with distance from any epicardial vessel (keeps base/atria neutral)
    reach = np.exp(-np.clip(D.min(1) - 0.10, 0, None) / 0.25)
    rgba = np.concatenate([W * reach[:, None], np.ones((len(V), 1))], 1)
    heart_wall_scene.visual = trimesh.visual.ColorVisuals(heart_wall_scene,
                                                          vertex_colors=(rgba * 255).astype(np.uint8))
    hp = next(p for p in parts if p["id"] == "heart_wall")
    scene.add_geometry(heart_wall_scene, node_name="heart_wall", geom_name="heart_wall",
                       metadata={k: hp[k] for k in ("id", "label", "group", "fma", "description")})
    terr_frac = {t: float((W.argmax(1) == i).mean()) for i, t in enumerate(terr_ids)}

    glb = scene.export(file_type="glb")
    (OUT_DIR / "heart_scene.glb").write_bytes(glb)

    # ---- centrelines (flow particles): each coronary part is rooted at the point closest to its parent
    cl = defaultdict(list)
    for p in parts:
        if not p.get("target"):
            continue
        parent = cKDTree(part_mm[p["parent"]].sample(8000))
        for path in centerline_paths(part_mm[p["id"]], parent):
            cl[p["target"]].append({"part": p["id"], "pts": np.round(to_scene(path, centre), 4).tolist()})
    for t, v in cl.items():
        print(f"centrelines {t}: {len(v)} paths, {sum(len(x['pts']) for x in v)} pts")
    (OUT_DIR / "centerlines.json").write_text(json.dumps(cl))

    meta = dict(source="BodyParts3D, (c) 2008 Life Science Integrated Database Center, CC BY-SA 2.1 JP",
                faces=stats, total_faces=int(sum(stats.values())), territory_fraction=terr_frac,
                centre_mm=centre.tolist(), scale=SCALE)
    (OUT_DIR / "anatomy_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
