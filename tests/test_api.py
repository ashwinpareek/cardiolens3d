"""API contract tests (FastAPI TestClient, no server needed)."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.main import app  # noqa: E402

client = TestClient(app)
PATIENT = json.loads((ROOT / "frontend" / "public" / "data" / "app_data.json").read_text())["patients"][0]["inputs"]


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_meta_lists_all_targets_and_features():
    m = client.get("/api/meta").json()
    assert [t["id"] for t in m["targets"]] == ["CAD", "LAD", "LCX", "RCA"]
    keys = {f["key"] for f in m["features"]}
    assert len(keys) == 54 and not keys & {"lad", "lcx", "rca", "cath"}


def test_predict_full_patient_with_sklearn_crosscheck():
    r = client.post("/api/predict?check=true", json={"inputs": PATIENT}).json()
    for t in ("CAD", "LAD", "LCX", "RCA"):
        p = r["targets"][t]
        assert 0 <= p["lo"] <= p["p"] <= p["hi"] <= 1
        assert r["sklearn_check"][t]["abs_diff"] < 1e-9
        a = r["attributions"][t]
        assert abs(a["base"] + sum(a["contributions"].values()) - a["value"]) < 1e-8
    assert r["warnings"] == []


def test_partial_input_is_filled_and_warned():
    r = client.post("/api/predict", json={"inputs": {"age": 70, "typical_cp": 1}}).json()
    assert r["warnings"] and "median" in r["warnings"][0]


@pytest.mark.parametrize("bad", [{"nonsense": 1}, {"sex_male": 3}, {"bbb": "XYZ"}, {"age": "old"}])
def test_bad_input_rejected(bad):
    assert client.post("/api/predict", json={"inputs": bad}).status_code == 422


def test_out_of_range_warns_not_fails():
    r = client.post("/api/predict", json={"inputs": {**PATIENT, "age": 120}})
    assert r.status_code == 200 and any("outside the range" in w for w in r.json()["warnings"])


def test_whatif_delta():
    r = client.post("/api/whatif", json={"inputs": PATIENT, "changes": {"typical_cp": 1 - PATIENT["typical_cp"]}}).json()
    d = r["after"]["targets"]["CAD"]["p"] - r["before"]["targets"]["CAD"]["p"]
    assert abs(d - r["delta"]["CAD"]) < 1e-12 and abs(d) > 0.01


def test_batch():
    r = client.post("/api/predict/batch", json={"items": [PATIENT, PATIENT]}).json()
    assert len(r["results"]) == 2
