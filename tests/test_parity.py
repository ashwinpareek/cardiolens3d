"""Parity + invariants. Run from repo root:  python -m pytest -q tests

1. ml/engine.py on the exported bundle == the original sklearn / interpret pipelines
2. the TypeScript browser engine == ml/engine.py (probabilities, intervals, sets, attributions)
3. attributions are complete: reference + sum(contributions) == patient log-odds
4. anatomical consistency: P(vessel) <= P(CAD)
5. no leakage columns among model inputs
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

import engine  # noqa: E402
from features import FEATURE_KEYS, LEAKAGE_COLUMNS, encode_inputs, load_raw, records_to_frame  # noqa: E402

DATA = json.loads((ROOT / "frontend" / "public" / "data" / "app_data.json").read_text())
BUNDLE = DATA["bundle"]
PATIENTS = DATA["patients"]


@pytest.fixture(scope="module")
def py_preds():
    return [engine.predict(BUNDLE, p["inputs"]) for p in PATIENTS]


def test_no_leakage_features():
    assert not set(LEAKAGE_COLUMNS) & set(FEATURE_KEYS)
    raw = load_raw(ROOT / "data" / "z_alizadeh_sani_extension.xlsx")
    assert not set(LEAKAGE_COLUMNS) & set(encode_inputs(raw).columns)
    for t in BUNDLE["targets"].values():
        assert not {term["key"] for term in t["model"]["terms"]} & {c.lower() for c in LEAKAGE_COLUMNS}


def test_engine_matches_sklearn(py_preds):
    import joblib
    m = joblib.load(ROOT / "ml" / "artifacts" / "cardiolens_model.joblib")["model"]
    P = m.predict_proba_sklearn(records_to_frame([p["inputs"] for p in PATIENTS]))
    for t in P:
        diff = np.abs(P[t] - np.array([r["targets"][t]["p"] for r in py_preds])).max()
        assert diff < 1e-9, (t, diff)


def test_attributions_complete(py_preds):
    for r in py_preds:
        for t, a in r["attributions"].items():
            assert abs(a["base"] + sum(a["contributions"].values()) - a["value"]) < 1e-8, t


def test_hierarchical_consistency(py_preds):
    for r in py_preds:
        for v in ("LAD", "LCX", "RCA"):
            assert r["targets"][v]["p"] <= r["targets"]["CAD"]["p"] + 1e-12


def test_intervals_contain_point(py_preds):
    for r in py_preds:
        for t in r["targets"].values():
            assert t["lo"] <= t["p"] <= t["hi"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_browser_engine_matches_python(py_preds, tmp_path):
    fe = ROOT / "frontend"
    esb = fe / "node_modules" / ".bin" / "esbuild"
    if not esb.exists():
        pytest.skip("frontend dependencies not installed")
    out = tmp_path / "engine.mjs"
    subprocess.run([str(esb), str(fe / "src" / "lib" / "engine.ts"), "--format=esm", f"--outfile={out}"], check=True,
                   capture_output=True)
    js = json.loads(subprocess.run(["node", str(ROOT / "tests" / "js_engine_dump.mjs"), str(out),
                                    str(fe / "public" / "data" / "app_data.json")],
                                   check=True, capture_output=True, text=True).stdout)
    worst = 0.0
    for a, b in zip(js, py_preds):
        for t in b["targets"]:
            for k in ("p", "lo", "hi", "threshold"):
                worst = max(worst, abs(a["targets"][t][k] - b["targets"][t][k]))
            assert a["targets"][t]["set"] == b["targets"][t]["set"]
            for f, v in b["attributions"][t]["contributions"].items():
                worst = max(worst, abs(a["attributions"][t]["contributions"][f] - v))
    assert worst < 1e-9, worst
