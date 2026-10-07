"""Experiment: anatomically-consistent hierarchical vessel model vs. direct vessel models.

Observation from the data: Cath == CAD  <=>  at least one of LAD/LCX/RCA is stenotic (302/303 rows).
So  P(vessel stenotic) = P(CAD) * P(vessel stenotic | CAD).
The hierarchical model learns the two factors separately (the second only on CAD-positive
patients) and guarantees P(vessel) <= P(CAD) -- the 3D view can never show a red artery on a
"no CAD" heart.

Same outer splits as compare_models.py (RepeatedStratifiedKFold 5x5, seed 42) so numbers are
paired with the direct models.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from joblib import Parallel, delayed
from sklearn.base import clone
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, StratifiedKFold

from features import encode_inputs, encode_targets, load_raw
from models import SEED, candidates

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "z_alizadeh_sani_extension.xlsx"


def fit_gs(name, X, y):
    pipe, grid = candidates()[name]
    gs = GridSearchCV(clone(pipe), grid, scoring="roc_auc", cv=StratifiedKFold(5, shuffle=True, random_state=SEED))
    gs.fit(X, y)
    return gs.best_estimator_


def run(vessel, cad_model, cond_model, X, Y, tr, te):
    ycad = Y["CAD"].values
    yv = Y[vessel].values
    m1 = fit_gs(cad_model, X.iloc[tr], ycad[tr])
    pos = tr[ycad[tr] == 1]
    m2 = fit_gs(cond_model, X.iloc[pos], yv[pos])
    p = m1.predict_proba(X.iloc[te])[:, 1] * m2.predict_proba(X.iloc[te])[:, 1]
    return te, p


def main():
    raw = load_raw(DATA)
    X, Y = encode_inputs(raw), encode_targets(raw)
    outer = RepeatedStratifiedKFold(n_splits=5, n_repeats=5, random_state=SEED)
    res = {}
    for v in ["LAD", "LCX", "RCA"]:
        splits = list(outer.split(X, Y[v].values))
        for cad_m, cond_m in [("logreg_l2", "logreg_l2"), ("logreg_l2", "logreg_l1")]:
            outs = Parallel(n_jobs=2)(delayed(run)(v, cad_m, cond_m, X, Y, tr, te) for tr, te in splits)
            aucs, briers = [], []
            oof = np.zeros((5, len(X)))
            for k, (te, p) in enumerate(outs):
                aucs.append(roc_auc_score(Y[v].values[te], p))
                briers.append(brier_score_loss(Y[v].values[te], p))
                oof[k // 5, te] = p
            key = f"hier[{cad_m}*{cond_m}]"
            res.setdefault(v, {})[key] = dict(auc=[float(np.mean(aucs)), float(np.std(aucs))],
                                               brier=float(np.mean(briers)), oof=oof.tolist(), folds_auc=aucs)
            print(f"{v} {key:36s} AUC {np.mean(aucs):.3f}±{np.std(aucs):.3f} brier {np.mean(briers):.3f}", flush=True)
    (ROOT / "ml" / "results" / "hier_experiment.json").write_text(json.dumps(res))


if __name__ == "__main__":
    main()
