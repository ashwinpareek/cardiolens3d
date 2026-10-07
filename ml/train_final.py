"""Stage 2: evaluate the COMPLETE CardioModel pipeline with repeated outer CV, run sanity checks,
fit the final model on all data, and export everything the app needs.

    python train_final.py [--repeats 5] [--boot 60] [--spec auto|fixed]

Outputs
  ml/artifacts/cardiolens_model.joblib      fitted sklearn pipelines + CardioModel (Python weights)
  ml/artifacts/model_bundle.json            portable JSON weights (backend + browser engine)
  ml/artifacts/model_card.json              all evaluation results
  frontend/public/data/app_data.json        bundle + feature schema + patients + presets + card
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.calibration import calibration_curve
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss, f1_score,
                             precision_score, recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict

import engine
from cardio_model import CardioModel, TargetSpec, conformal_set
from features import (FEATURES, LEAKAGE_COLUMNS, TARGET_IDS, encode_inputs, encode_targets, load_raw,
                      schema_json)
from models import SEED, candidates

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "z_alizadeh_sani_extension.xlsx"
ART = ROOT / "ml" / "artifacts"
RES = ROOT / "ml" / "results"
WEB = ROOT / "frontend" / "public" / "data"

ALPHA = 0.10
MODEL_LABEL = {"logreg_l2": "Logistic regression (L2)", "logreg_l1": "Logistic regression (L1)",
               "ebm": "Explainable Boosting Machine"}


def make_spec(mode: str) -> dict:
    # EBM (glass-box GAM) is supported by CardioModel but lost to logistic regression on every target in
    # the nested comparison (see results/compare_*.json) and is ~50x slower, so the inner search covers L2/L1.
    fam = "auto:logreg_l2,logreg_l1" if mode == "auto" else "logreg_l2"
    return {"CAD": TargetSpec(fam, "direct"), "LAD": TargetSpec(fam, "hierarchical"),
            "LCX": TargetSpec(fam, "hierarchical"), "RCA": TargetSpec(fam, "hierarchical")}


def strat_key(Y: pd.DataFrame) -> np.ndarray:
    # multilabel stratification proxy: CAD status x number of diseased vessels
    return (Y["CAD"].astype(str) + Y[["LAD", "LCX", "RCA"]].sum(1).clip(0, 3).astype(str)).replace({"01": "11"}).values


def fold_metrics(y, p, thr):
    yhat = (p >= thr).astype(int)
    tn = int(((yhat == 0) & (y == 0)).sum())
    fp = int(((yhat == 1) & (y == 0)).sum())
    return dict(auc=roc_auc_score(y, p), pr_auc=average_precision_score(y, p), brier=brier_score_loss(y, p),
                accuracy=accuracy_score(y, yhat), precision=precision_score(y, yhat, zero_division=0),
                recall=recall_score(y, yhat), specificity=tn / max(1, tn + fp), f1=f1_score(y, yhat))


def run_outer_fold(spec, X, Y, tr, te):
    t0 = time.time()
    m = CardioModel(spec, alpha=ALPHA, n_boot=0).fit(X.iloc[tr], Y.iloc[tr])
    P = m.predict_proba(X.iloc[te])
    out = {"te": te, "secs": time.time() - t0, "families": {k: m.t[k]["family"] for k in m.t}}
    for t in TARGET_IDS:
        y = Y[t].values[te]
        p = P[t]
        sets = [conformal_set(pi, m.t[t]["conformal"]) for pi in p]
        out[t] = dict(p=p, thr=m.t[t]["threshold"],
                      covered=[int(y[i] in s) for i, s in enumerate(sets)],
                      size=[len(s) for s in sets],
                      metrics=fold_metrics(y, p, m.t[t]["threshold"]),
                      metrics05=fold_metrics(y, p, 0.5))
    out["violations"] = int(sum((P[v] > P["CAD"] + 1e-12).sum() for v in ["LAD", "LCX", "RCA"]))
    return out


def summarize(folds, key="metrics"):
    ks = folds[0][key].keys()
    return {k: [float(np.mean([f[key][k] for f in folds])), float(np.std([f[key][k] for f in folds]))] for k in ks}


def bootstrap_ci(y, p, fn, n=1000, seed=0):
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if len(np.unique(y[i])) < 2:
            continue
        vals.append(fn(y[i], p[i]))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def dca(y, p, thresholds):
    n = len(y)
    prev = y.mean()
    rows = []
    for t in thresholds:
        pred = p >= t
        tp = ((pred == 1) & (y == 1)).sum()
        fp = ((pred == 1) & (y == 0)).sum()
        nb = tp / n - fp / n * t / (1 - t)
        nb_all = prev - (1 - prev) * t / (1 - t)
        rows.append([float(t), float(nb), float(nb_all)])
    return rows


def roc_points(y, p, k=60):
    fpr, tpr, thr = roc_curve(y, p)
    idx = np.unique(np.linspace(0, len(fpr) - 1, min(k, len(fpr))).astype(int))
    return [[float(fpr[i]), float(tpr[i]), float(min(thr[i], 1.0))] for i in idx]


def calib_points(y, p, bins=10):
    frac, mean = calibration_curve(y, p, n_bins=bins, strategy="quantile")
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    counts = np.histogram(p, bins=np.unique(edges))[0]
    return [[float(m), float(f), int(c)] for m, f, c in zip(mean, frac, counts)]


# --------------------------------------------------------------------------------- sanity checks
def sanity_checks(X, Y):
    rows = []
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    pipe, _ = candidates()["logreg_l2"]
    pipe.set_params(clf__C=0.03)
    # 1. label permutation: the pipeline must not find signal in shuffled labels
    rng = np.random.default_rng(SEED)
    perm = []
    for _ in range(20):
        yp = rng.permutation(Y["CAD"].values)
        pr = cross_val_predict(pipe, X, yp, cv=cv, method="predict_proba")[:, 1]
        perm.append(roc_auc_score(yp, pr))
    rows.append(["Label-permutation test (CAD, 20 shuffles)", f"AUC {np.mean(perm):.3f} ± {np.std(perm):.3f}",
                 "≈0.5 expected: the pipeline does not invent signal"])
    # 2. what leakage would look like: add the forbidden vessel columns as inputs
    raw = load_raw(DATA)
    XL = X.copy()
    for c in ["LAD", "LCX", "RCA"]:
        XL[c.lower() + "_leak"] = (raw[c] == "Stenotic").astype(int)
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    leak = Pipeline([("s", StandardScaler()), ("c", LogisticRegression(max_iter=3000))])
    pr = cross_val_predict(leak, XL.drop(columns=["bbb"]), Y["CAD"], cv=cv, method="predict_proba")[:, 1]
    rows.append(["If LAD/LCX/RCA were (wrongly) used as inputs", f"CAD AUC {roc_auc_score(Y['CAD'], pr):.3f}",
                 "Near-perfect = target leakage. These columns are excluded everywhere."])
    assert not set(LEAKAGE_COLUMNS) & set(X.columns)
    rows.append(["Leakage columns in model inputs", "none", "asserted in code: LAD, LCX, RCA, Cath are never features"])
    return rows


# --------------------------------------------------------------------------------- presets
def presets(X: pd.DataFrame):
    med = {}
    for f in FEATURES:
        col = X[f.key]
        if f.kind == "numeric":
            v = float(col.median())
            med[f.key] = round(v, 1) if f.step and f.step < 1 else int(round(v))
        else:
            med[f.key] = col.mode().iloc[0]
            if f.kind != "categorical":
                med[f.key] = int(med[f.key])

    def mk(pid, label, **kw):
        d = dict(med)
        d.update(kw)
        d["bmi"] = round(d["weight"] / (d["height"] / 100) ** 2, 1)
        d["obesity"] = int(d["bmi"] > 25)
        return {"id": pid, "label": label, "inputs": d}

    none = {k: 0 for k in ["dm", "htn", "current_smoker", "ex_smoker", "fh", "dlp", "typical_cp", "atypical",
                            "nonanginal", "dyspnea", "q_wave", "st_elevation", "st_depression", "t_inversion",
                            "lvh", "poor_r", "edema", "lowth_ang", "chf", "crf", "cva"]}
    return [
        mk("median", "Dataset median patient"),
        mk("angina", "62 M, typical angina, diabetic", **{**none, "age": 62, "sex_male": 1, "weight": 80, "height": 170,
           "dm": 1, "htn": 1, "dlp": 1, "typical_cp": 1, "function_class": 2, "fbs": 160, "ldl": 135, "hdl": 34,
           "tg": 210, "bp": 145, "st_depression": 1, "ef": 50, "rwma": 0}),
        mk("lowrisk", "44 F, atypical pain, no risk factors", **{**none, "age": 44, "sex_male": 0, "weight": 62, "height": 160,
           "atypical": 1, "fbs": 88, "ldl": 95, "hdl": 52, "tg": 110, "bp": 115, "pr": 74, "ef": 60, "rwma": 0,
           "function_class": 0}),
        mk("infarct", "70 M, prior-infarct pattern", **{**none, "age": 70, "sex_male": 1, "weight": 74, "height": 168,
           "htn": 1, "ex_smoker": 1, "typical_cp": 1, "q_wave": 1, "t_inversion": 1, "ef": 35, "rwma": 2,
           "function_class": 2, "dyspnea": 1, "bp": 130, "pr": 88}),
    ]


def jsonable(o):
    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return jsonable(o.tolist())
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--boot", type=int, default=60)
    ap.add_argument("--spec", default="auto", choices=["auto", "fixed"])
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()
    ART.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)

    raw = load_raw(DATA)
    X, Y = encode_inputs(raw), encode_targets(raw)
    spec = make_spec(a.spec)

    # ---------------- 1. outer CV of the complete pipeline
    outer = RepeatedStratifiedKFold(n_splits=5, n_repeats=a.repeats, random_state=SEED)
    splits = list(outer.split(X, strat_key(Y)))
    t0 = time.time()
    folds = Parallel(n_jobs=a.jobs, verbose=5)(delayed(run_outer_fold)(spec, X, Y, tr, te) for tr, te in splits)
    print(f"outer CV done in {time.time()-t0:.0f}s", flush=True)

    n = len(X)
    oof = {t: np.zeros((a.repeats, n)) for t in TARGET_IDS}
    for k, f in enumerate(folds):
        for t in TARGET_IDS:
            oof[t][k // 5, f["te"]] = f[t]["p"]

    card_t = {}
    fam_counts = {}
    for t in TARGET_IDS:
        tf = [f[t] for f in folds]
        y = Y[t].values
        yy = np.tile(y, a.repeats)
        pp = oof[t].ravel()
        cov = np.concatenate([f["covered"] for f in tf])
        size = np.concatenate([f["size"] for f in tf])
        fam_counts[t] = pd.Series([f["families"][t] for f in folds]).value_counts().to_dict()
        card_t[t] = dict(
            metrics=summarize(tf, "metrics"), metrics_at_0_5=summarize(tf, "metrics05"),
            pooled_auc_ci95=bootstrap_ci(y, oof[t][0], roc_auc_score),
            roc=roc_points(yy, pp), calibration=calib_points(yy, pp),
            dca=dca(yy, pp, np.round(np.arange(0.02, 0.91, 0.02), 2)) if t == "CAD" else dca(yy, pp, np.round(np.arange(0.02, 0.91, 0.02), 2)),
            conformal=dict(coverage=float(cov.mean()), singleton_rate=float((size == 1).mean()),
                           empty_rate=float((size == 0).mean()), avg_size=float(size.mean())),
            prevalence=float(y.mean()), n_folds=len(folds), outer_families=fam_counts[t],
        )
        m = card_t[t]["metrics"]
        print(f"{t}: AUC {m['auc'][0]:.3f}±{m['auc'][1]:.3f}  F1 {m['f1'][0]:.3f}  acc {m['accuracy'][0]:.3f}  "
              f"brier {m['brier'][0]:.3f}  cover {card_t[t]['conformal']['coverage']:.3f}  "
              f"singletons {card_t[t]['conformal']['singleton_rate']:.2f}  fams {fam_counts[t]}", flush=True)
    violations = int(sum(f["violations"] for f in folds))

    # ---------------- 2. subgroup performance (pooled OOF, repeat 0)
    sub = {}
    groups = {"Female": X.sex_male == 0, "Male": X.sex_male == 1, "Age < 60": X.age < 60, "Age ≥ 60": X.age >= 60,
              "Diabetic": X.dm == 1, "Non-diabetic": X.dm == 0}
    for g, mask in groups.items():
        mask = mask.values
        sub[g] = {"n": int(mask.sum())}
        for t in TARGET_IDS:
            y = Y[t].values[mask]
            sub[g][t] = float(roc_auc_score(y, oof[t][0][mask])) if len(np.unique(y)) > 1 else None

    # ---------------- 3. sanity checks
    sanity_rows = sanity_checks(X, Y)
    sanity_rows.append(["Anatomical consistency P(vessel) ≤ P(CAD)", f"{violations} violations",
                        f"checked on every out-of-fold prediction ({len(folds)} folds)"])

    # ---------------- 4. final fit on all data
    print("fitting final model …", flush=True)
    final = CardioModel(spec, alpha=ALPHA, n_boot=a.boot).fit(X, Y)
    bundle = jsonable(final.export_bundle())
    joblib.dump({"model": final, "features": [f.key for f in FEATURES]}, ART / "cardiolens_model.joblib")
    (ART / "model_bundle.json").write_text(json.dumps(bundle))

    # global importance for similarity weighting & docs: mean |attribution| for CAD
    recs = X.to_dict("records")
    preds = [engine.predict(bundle, r) for r in recs]
    imp = {k: float(np.mean([abs(p["attributions"]["CAD"]["contributions"][k]) for p in preds])) for k in X.columns}
    imp_v = {t: {k: float(np.mean([abs(p["attributions"][t]["contributions"][k]) for p in preds])) for k in X.columns}
             for t in TARGET_IDS}
    s = sum(imp.values())
    similar_weights = {k: v / s * len(imp) for k, v in imp.items()}

    # ---------------- 5. model card
    comparison = {}
    for t in TARGET_IDS:
        rows = []
        for fname in ["compare_%s.json" % t]:
            d = json.loads((RES / fname).read_text()) if (RES / fname).exists() else {}
            for name, r in d.items():
                rows.append({"model": name, **{k: r["summary"][k] for k in ("auc", "brier", "f1", "accuracy")}})
        ab = RES / "structure_ablation.json"
        if ab.exists():
            abd = json.loads(ab.read_text())
            for st, nm in (("direct", "CardioModel, direct vessels (calibrated)"),
                           ("hierarchical", "CardioModel, hierarchical (deployed)")):
                r = abd[st][t]["summary"]
                rows.append({"model": nm, **{k: r[k] for k in ("auc", "brier", "f1", "accuracy")}})
        comparison[t] = rows

    card = {
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "dataset": {"name": "Extension of Z-Alizadeh Sani dataset (UCI)", "n": int(n),
                    "prevalence": {t: float(Y[t].mean()) for t in TARGET_IDS},
                    "url": "https://archive.ics.uci.edu/dataset/411/extention+of+z+alizadeh+sani+dataset", "doi": "10.24432/C5461K", "license": "CC BY 4.0"},
        "alpha": ALPHA,
        "validation": f"{a.repeats}x repeated stratified 5-fold outer CV of the full pipeline; inner 5-fold CV for "
                      f"algorithm + hyper-parameters; inner out-of-fold predictions for Platt calibration, Youden "
                      f"threshold and Mondrian conformal quantiles.",
        "targets": {t: {**card_t[t], "model": final.t[t]["family"], "model_label": MODEL_LABEL[final.t[t]["family"]],
                        "structure": final.t[t]["structure"], "params": final.t[t]["params"],
                        "importance": dict(sorted(imp_v[t].items(), key=lambda kv: -kv[1]))}
                    for t in TARGET_IDS},
        "comparison": comparison,
        "subgroups": sub,
        "shap_check": json.loads((RES / "shap_check.json").read_text()) if (RES / "shap_check.json").exists() else None,
        "ablation": json.loads((RES / "structure_ablation.json").read_text()).get("paired_delta_auc")
        if (RES / "structure_ablation.json").exists() else None,
        "sanity": {"rows": sanity_rows, "violations": violations,
                   "direct_violations": json.loads((RES / "structure_ablation.json").read_text())["direct"]["violations"]
                   if (RES / "structure_ablation.json").exists() else None},
    }
    card = jsonable(card)
    (ART / "model_card.json").write_text(json.dumps(card, indent=1))

    # ---------------- 6. app data
    patients = []
    for i, r in enumerate(recs):
        patients.append({"id": i, "inputs": {k: (v if isinstance(v, str) else (float(v) if not float(v).is_integer() else int(v)))
                                             for k, v in r.items()},
                         "labels": {t: int(Y[t].iloc[i]) for t in TARGET_IDS},
                         "oof": {t: float(oof[t][0][i]) for t in TARGET_IDS}})
    app = {"features": schema_json(), "patients": patients, "presets": presets(X), "card": card,
           "similar_weights": similar_weights, "bundle": bundle}
    (WEB / "app_data.json").write_text(json.dumps(jsonable(app), separators=(",", ":")))
    print("wrote", WEB / "app_data.json", f"{(WEB / 'app_data.json').stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()
