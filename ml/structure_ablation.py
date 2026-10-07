"""Ablation: direct vessel models vs the hierarchical P(CAD) * P(vessel | CAD) structure.

Both variants are the COMPLETE calibrated pipeline (CardioModel), evaluated on identical
outer splits (5x repeated stratified 5-fold), so the difference is paired.
Writes results/structure_ablation.json, read by train_final.py for the model card.
"""
import json
import sys

import numpy as np
from joblib import Parallel, delayed
from sklearn.model_selection import RepeatedStratifiedKFold

from cardio_model import TargetSpec
from features import TARGET_IDS, encode_inputs, encode_targets, load_raw
from models import SEED
from train_final import DATA, RES, run_outer_fold, strat_key, summarize

FAM = "auto:logreg_l2,logreg_l1"


def spec(structure):
    return {"CAD": TargetSpec(FAM, "direct"), **{v: TargetSpec(FAM, structure) for v in ("LAD", "LCX", "RCA")}}


def main(repeats=5):
    raw = load_raw(DATA)
    X, Y = encode_inputs(raw), encode_targets(raw)
    splits = list(RepeatedStratifiedKFold(n_splits=5, n_repeats=repeats, random_state=SEED).split(X, strat_key(Y)))
    out = {}
    for structure in ("direct", "hierarchical"):
        folds = Parallel(n_jobs=2)(delayed(run_outer_fold)(spec(structure), X, Y, tr, te) for tr, te in splits)
        out[structure] = {t: {"summary": summarize([f[t] for f in folds]),
                              "fold_auc": [f[t]["metrics"]["auc"] for f in folds]} for t in TARGET_IDS}
        out[structure]["violations"] = int(sum(f["violations"] for f in folds))
        for t in TARGET_IDS:
            s = out[structure][t]["summary"]
            print(f"{structure:12s} {t}: AUC {s['auc'][0]:.3f}±{s['auc'][1]:.3f} brier {s['brier'][0]:.3f} "
                  f"F1 {s['f1'][0]:.3f}", flush=True)
        print(structure, "violations", out[structure]["violations"], flush=True)
    for t in ("LAD", "LCX", "RCA"):
        d = np.array(out["hierarchical"][t]["fold_auc"]) - np.array(out["direct"][t]["fold_auc"])
        out.setdefault("paired_delta_auc", {})[t] = [float(d.mean()), float(d.std()), int((d > 0).sum()), len(d)]
        print(f"{t}: hierarchical - direct AUC = {d.mean():+.3f} ± {d.std():.3f} (better in {(d > 0).sum()}/{len(d)} folds)")
    (RES / "structure_ablation.json").write_text(json.dumps(out))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)
