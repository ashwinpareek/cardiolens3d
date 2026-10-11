"""Why our accuracy looks lower than many reports on this dataset: single-split optimism.

    python ml/split_optimism.py [--splits 100]

Runs the SAME deployed CardioModel pipeline on many single random 80/20 train/test splits (the usual
hackathon / notebook protocol) and records CAD performance on each 61-patient test set:
  * accuracy at the model's own threshold (chosen on training data only: legitimate),
  * accuracy at a threshold tuned on the test set itself (a common, leaky shortcut).
Reporting the best of many splits, or tuning on the test set, inflates the number. The nested,
repeated cross-validation figure in the model card is the honest estimate.

Output: ml/results/split_optimism.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from joblib import Parallel, delayed
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from cardio_model import CardioModel
from features import encode_inputs, encode_targets, load_raw
from train_final import ALPHA, DATA, make_spec, strat_key

OUT = Path(__file__).resolve().parents[1] / "ml" / "results" / "split_optimism.json"


def one(seed, X, Y, spec):
    tr, te = train_test_split(np.arange(len(Y)), test_size=0.2, random_state=seed, stratify=strat_key(Y))
    m = CardioModel(spec, alpha=ALPHA, n_boot=0, seed=seed).fit(X.iloc[tr], Y.iloc[tr])
    y, p = Y["CAD"].values[te], m.predict_proba(X.iloc[te])["CAD"]
    acc = float(((p >= m.t["CAD"]["threshold"]).astype(int) == y).mean())
    best = max(float(((p >= t).astype(int) == y).mean()) for t in np.unique(np.r_[p, 1.01]))
    return {"seed": seed, "auc": float(roc_auc_score(y, p)), "acc": acc, "acc_test_tuned": best}


def pct(a, q):
    return float(np.percentile(a, q))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--splits", type=int, default=100)
    a = ap.parse_args()
    raw = load_raw(DATA)
    X, Y = encode_inputs(raw), encode_targets(raw)
    spec = make_spec("auto")
    rows = Parallel(n_jobs=-1)(delayed(one)(s, X, Y, spec) for s in range(a.splits))
    acc, auc, tuned = (np.array([r[k] for r in rows]) for k in ("acc", "auc", "acc_test_tuned"))
    card = json.loads((OUT.parents[1] / "artifacts" / "model_card.json").read_text())
    res = {
        "splits": a.splits, "test_size": 61,
        "nested_cv": {"accuracy": card["targets"]["CAD"]["metrics"]["accuracy"],
                      "auc": card["targets"]["CAD"]["metrics"]["auc"]},
        "single_split_accuracy": {"median": pct(acc, 50), "p5": pct(acc, 5), "p95": pct(acc, 95), "max": float(acc.max())},
        "single_split_auc": {"median": pct(auc, 50), "p5": pct(auc, 5), "p95": pct(auc, 95), "max": float(auc.max())},
        "test_tuned_threshold_accuracy": {"median": pct(tuned, 50), "max": float(tuned.max())},
        "share_of_splits_at_or_above_90pct_acc": float((acc >= 0.90).mean()),
        "rows": rows,
    }
    OUT.write_text(json.dumps(res, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    main()
