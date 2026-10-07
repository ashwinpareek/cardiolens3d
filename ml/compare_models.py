"""Stage 1: leakage-free nested cross-validation model comparison.

Outer loop : RepeatedStratifiedKFold (5 folds x R repeats) -> unbiased performance estimate
Inner loop : StratifiedKFold (5 folds) GridSearchCV on the outer-training part only -> hyper-params

Outputs results/compare_<target>.json with per-model fold metrics and out-of-fold probabilities.
Usage: python compare_models.py [--repeats 5] [--targets CAD LAD LCX RCA] [--models ...]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from joblib import Parallel, delayed
from sklearn.base import clone
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, StratifiedKFold

from features import TARGET_IDS, encode_inputs, encode_targets, load_raw
from models import SEED, candidates

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "z_alizadeh_sani_extension.xlsx"
OUT = ROOT / "ml" / "results"


def fold_metrics(y, p, thr=0.5):
    yhat = (p >= thr).astype(int)
    return dict(auc=roc_auc_score(y, p), pr_auc=average_precision_score(y, p), brier=brier_score_loss(y, p),
                accuracy=accuracy_score(y, yhat), precision=precision_score(y, yhat, zero_division=0),
                recall=recall_score(y, yhat), f1=f1_score(y, yhat))


def run_fold(name, pipe, grid, X, y, tr, te):
    inner = StratifiedKFold(5, shuffle=True, random_state=SEED)
    gs = GridSearchCV(clone(pipe), grid, scoring="roc_auc", cv=inner, n_jobs=1, refit=True)
    gs.fit(X.iloc[tr], y[tr])
    p = gs.predict_proba(X.iloc[te])[:, 1]
    return te, p, gs.best_params_


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--targets", nargs="*", default=TARGET_IDS)
    ap.add_argument("--models", nargs="*", default=None)
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()

    raw = load_raw(DATA)
    X, Y = encode_inputs(raw), encode_targets(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    zoo = candidates()
    names = a.models or list(zoo)

    for t in a.targets:
        y = Y[t].values
        outer = RepeatedStratifiedKFold(n_splits=5, n_repeats=a.repeats, random_state=SEED)
        splits = list(outer.split(X, y))
        res = {}
        path = OUT / f"compare_{t}.json"
        if path.exists():
            res = json.loads(path.read_text())
        for name in names:
            pipe, grid = zoo[name]
            t0 = time.time()
            outs = Parallel(n_jobs=a.jobs)(delayed(run_fold)(name, pipe, grid, X, y, tr, te) for tr, te in splits)
            oof = np.zeros((a.repeats, len(y)))
            folds, params = [], []
            for k, (te, p, bp) in enumerate(outs):
                oof[k // 5, te] = p
                folds.append(fold_metrics(y[te], p))
                params.append(bp)
            summ = {m: [float(np.mean([f[m] for f in folds])), float(np.std([f[m] for f in folds]))]
                    for m in folds[0]}
            res[name] = dict(summary=summ, folds=folds, oof=oof.tolist(), params=[str(p) for p in params])
            print(f"{t:4s} {name:14s} AUC {summ['auc'][0]:.3f}±{summ['auc'][1]:.3f}  "
                  f"F1 {summ['f1'][0]:.3f}  acc {summ['accuracy'][0]:.3f}  brier {summ['brier'][0]:.3f}  "
                  f"({time.time()-t0:.0f}s)", flush=True)
            path.write_text(json.dumps(res))


if __name__ == "__main__":
    main()
