"""Compare freshly computed metrics with the committed reference values.

    python ml/check_reproduction.py            # check (exit 1 on mismatch)
    python ml/check_reproduction.py --freeze   # write the current values as the new reference

Run by `make reproduce` after training, so anyone can confirm the reported numbers come out of the code.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARD = ROOT / "ml" / "artifacts" / "model_card.json"
REF = ROOT / "ml" / "results" / "expected_metrics.json"
TOL = 0.005  # absolute; leaves room for BLAS / platform differences in the last digits


def current() -> dict:
    c = json.loads(CARD.read_text())
    out = {}
    for t, v in c["targets"].items():
        for k in ("auc", "accuracy", "brier"):
            out[f"{t}.{k}"] = v["metrics"][k][0]
        out[f"{t}.conformal_coverage"] = v["conformal"]["coverage"]
    out["violations"] = c["sanity"]["violations"]
    if "external" in c:
        out["external.pooled_auc"] = c["external"]["external"]["pooled"]["auc"]
        out["external.internal_auc"] = c["external"]["internal_nested_cv_auc"][0]
    if "split_optimism" in c:
        out["split_optimism.max_accuracy"] = c["split_optimism"]["single_split_accuracy"]["max"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true")
    a = ap.parse_args()
    now = current()
    if a.freeze:
        REF.write_text(json.dumps(now, indent=1))
        print(f"wrote {REF.relative_to(ROOT)} ({len(now)} values)")
        return
    ref = json.loads(REF.read_text())
    bad = []
    for k, v in ref.items():
        got = now.get(k)
        ok = got is not None and abs(got - v) <= TOL
        print(f"{'ok ' if ok else 'BAD'} {k:34s} expected {v:.4f}  got {'missing' if got is None else f'{got:.4f}'}")
        if not ok:
            bad.append(k)
    if bad:
        sys.exit(f"{len(bad)} metric(s) differ from the reference by more than {TOL}")
    print(f"all {len(ref)} metrics reproduced within ±{TOL}")


if __name__ == "__main__":
    main()
