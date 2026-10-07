"""CardioLens 3D model server.

    uvicorn backend.app.main:app --port 8000          (from the repository root)

Endpoints
  GET  /api/health                     liveness + model version
  GET  /api/meta                       feature schema, target registry, model card
  GET  /api/patients/{id}              one dataset patient (inputs, angiography labels, out-of-fold scores)
  POST /api/predict                    {"inputs": {...}} -> probabilities, intervals, conformal sets, attributions
  POST /api/predict/batch              {"items": [{...}, ...]}
  POST /api/whatif                     {"inputs": {...}, "changes": {...}} -> before/after + delta per target
  GET  /                               the built web app (frontend/dist), if present

Predictions are computed from the exported model bundle by ml/engine.py; every response can also be
cross-checked against the original sklearn pipelines (?check=true) to prove the two agree.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

import engine  # noqa: E402
from features import FEATURE_BY_KEY, FEATURES, TARGETS, records_to_frame  # noqa: E402

ART = ROOT / "ml" / "artifacts"
APP_DATA = ROOT / "frontend" / "public" / "data" / "app_data.json"
DIST = ROOT / "frontend" / "dist"
REGISTRY = json.loads((ROOT / "config" / "registry.json").read_text())


class State:
    bundle: dict
    app_data: dict
    sk_model: Any = None


S = State()


def load():
    S.bundle = json.loads((ART / "model_bundle.json").read_text())
    S.app_data = json.loads(APP_DATA.read_text())
    try:
        import joblib
        S.sk_model = joblib.load(ART / "cardiolens_model.joblib")["model"]
    except Exception as e:  # sklearn weights are optional for serving
        print("sklearn cross-check unavailable:", e)


load()

app = FastAPI(title="CardioLens 3D", version="1.0.0",
              description="Coronary artery disease and per-vessel stenosis risk with exact attributions. "
                          "Decision support / education only - not a diagnostic device.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ------------------------------------------------------------------------- validation
class PredictIn(BaseModel):
    inputs: dict[str, Any] = Field(..., description="Feature key -> value. Missing keys are filled with the dataset median patient.")


class BatchIn(BaseModel):
    items: list[dict[str, Any]]


class WhatIfIn(BaseModel):
    inputs: dict[str, Any]
    changes: dict[str, Any]


def _defaults() -> dict:
    return next(p for p in S.app_data["presets"] if p["id"] == "median")["inputs"]


def validate(inp: dict) -> tuple[dict, list[str]]:
    x, warnings = dict(_defaults()), []
    unknown = set(inp) - set(FEATURE_BY_KEY)
    if unknown:
        raise HTTPException(422, f"unknown feature(s): {sorted(unknown)}")
    for k, v in inp.items():
        f = FEATURE_BY_KEY[k]
        if f.kind == "categorical":
            allowed = [o[0] for o in f.options]
            if str(v) not in allowed:
                raise HTTPException(422, f"{k} must be one of {allowed}")
            x[k] = str(v)
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise HTTPException(422, f"{k} must be numeric")
        if f.kind in ("binary", "ordinal"):
            allowed = [o[0] for o in f.options]
            if v not in allowed:
                raise HTTPException(422, f"{k} must be one of {allowed}")
        elif f.minimum is not None and not (f.minimum <= v <= f.maximum):
            warnings.append(f"{k}={v} is outside the range seen in training ({f.minimum}-{f.maximum}); "
                            f"the estimate is an extrapolation")
        x[k] = v
    missing = sorted(set(FEATURE_BY_KEY) - set(inp))
    if missing:
        warnings.append(f"{len(missing)} feature(s) not supplied, filled with the dataset median patient: {missing}")
    return x, warnings


def _predict(x: dict, check: bool = False) -> dict:
    t0 = time.perf_counter()
    r = engine.predict(S.bundle, x)
    r["ms"] = (time.perf_counter() - t0) * 1000
    if check and S.sk_model is not None:
        P = S.sk_model.predict_proba_sklearn(records_to_frame([x]))
        r["sklearn_check"] = {t: {"sklearn": float(P[t][0]), "abs_diff": abs(float(P[t][0]) - r["targets"][t]["p"])}
                              for t in P}
    return r


# ------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {"status": "ok", "model_created": S.app_data["card"]["created"], "targets": list(TARGETS)}


@app.get("/api/meta")
def meta():
    d = S.app_data
    return {"features": d["features"], "targets": REGISTRY["targets"], "card": d["card"], "presets": d["presets"]}


@app.get("/api/patients/{pid}")
def patient(pid: int):
    ps = S.app_data["patients"]
    if not 0 <= pid < len(ps):
        raise HTTPException(404, "no such patient")
    return ps[pid]


@app.post("/api/predict")
def predict(body: PredictIn, check: bool = Query(False, description="also score with the sklearn pipelines")):
    x, warnings = validate(body.inputs)
    r = _predict(x, check)
    r["warnings"] = warnings
    return r


@app.post("/api/predict/batch")
def predict_batch(body: BatchIn):
    if len(body.items) > 1000:
        raise HTTPException(413, "max 1000 items per batch")
    return {"results": [_predict(validate(i)[0]) for i in body.items]}


@app.post("/api/whatif")
def whatif(body: WhatIfIn):
    x0, _ = validate(body.inputs)
    x1, w = validate({**body.inputs, **body.changes})
    a, b = _predict(x0), _predict(x1)
    return {"before": a, "after": b, "warnings": w,
            "delta": {t: b["targets"][t]["p"] - a["targets"][t]["p"] for t in a["targets"]}}


# ------------------------------------------------------------------------- static web app
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    for sub in ("anatomy", "data"):
        if (DIST / sub).exists():
            app.mount(f"/{sub}", StaticFiles(directory=DIST / sub), name=sub)

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")
