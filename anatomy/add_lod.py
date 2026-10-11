"""Add a low-poly level of detail of the heart wall to an (uncompressed) anatomy GLB.

    python anatomy/add_lod.py heart_raw.glb heart_raw_lod.glb [--faces 12000]
    npx @gltf-transform/cli meshopt heart_raw_lod.glb frontend/public/anatomy/heart_scene.glb

The adaptive-quality mode of the viewer swaps the 60k-triangle myocardium for this one when the frame
rate drops. Perfusion-territory weights (COLOR_0) are carried over from the nearest full-resolution vertex.
build_anatomy.py calls add_heart_lod() too, so a full rebuild includes it.
"""
from __future__ import annotations

import argparse

import fast_simplification
import numpy as np
import trimesh
from scipy.spatial import cKDTree


def add_heart_lod(scene: trimesh.Scene, faces: int = 12000) -> trimesh.Trimesh:
    hi = scene.geometry["heart_wall"]
    ratio = 1.0 - faces / len(hi.faces)
    v, f = fast_simplification.simplify(np.asarray(hi.vertices, np.float32), np.asarray(hi.faces), target_reduction=ratio)
    lo = trimesh.Trimesh(v, f, process=False)
    lo.fix_normals()
    _, idx = cKDTree(hi.vertices).query(lo.vertices)
    lo.visual = trimesh.visual.ColorVisuals(lo, vertex_colors=np.asarray(hi.visual.vertex_colors)[idx])
    scene.add_geometry(lo, node_name="heart_wall_lo", geom_name="heart_wall_lo")
    return lo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--faces", type=int, default=12000)
    a = ap.parse_args()
    scene = trimesh.load(a.src, force="scene")
    assert "heart_wall_lo" not in scene.geometry, "already has a LOD"
    lo = add_heart_lod(scene, a.faces)
    with open(a.dst, "wb") as fh:
        fh.write(scene.export(file_type="glb"))
    print(f"heart_wall {len(scene.geometry['heart_wall'].faces)} -> heart_wall_lo {len(lo.faces)} faces; "
          f"{len(scene.geometry)} geometries")


if __name__ == "__main__":
    main()
