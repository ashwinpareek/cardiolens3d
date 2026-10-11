"""External validation: train on Z-Alizadeh Sani, test on the four UCI Heart Disease cohorts.

    python ml/external_validation.py

Both datasets label a patient positive when angiography shows >=50% narrowing in at least one major
coronary artery, so overall CAD can be tested across populations. Individual vessels (LAD/LCX/RCA)
cannot: the UCI cohorts do not record which artery is narrowed.

Only features measured in BOTH datasets are used (a reduced model, separate from the deployed 54-feature
model):
  age, sex, chest-pain type (typical / atypical / non-anginal / none), resting systolic BP,
  fasting blood sugar >120 mg/dL, resting ECG ST-T abnormality, resting ECG LVH,
  total cholesterol (Z-Alizadeh Sani: estimated as LDL + HDL + TG/5, the Friedewald identity).
Deliberately excluded from UCI: `ca` (fluoroscopy-coloured vessel count, effectively part of the
angiographic answer), `thal`, exercise-test variables (thalach, exang, oldpeak, slope) that Z-Alizadeh
Sani does not have.

Missing values (UCI chol = 0 means not measured: all of Switzerland, 49 VA patients) are imputed with the
Z-Alizadeh Sani training median, so no information from the test cohorts leaks into the model.

Output: ml/results/external_validation.json
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score, roc_curve
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from features import encode_inputs, encode_targets, load_raw, LEAKAGE_COLUMNS
from models import SEED

ROOT = Path(__file__).resolve().parents[1]
ZAS = ROOT / "data" / "z_alizadeh_sani_extension.xlsx"
UCI = ROOT / "data" / "external" / "uci_heart_disease_920.csv"
OUT = ROOT / "ml" / "results" / "external_validation.json"

COLS = ["age", "sex_male", "typical_cp", "atypical", "nonanginal", "bp", "fbs_high", "ecg_stt", "lvh", "tchol"]
LABELS = {"age": "Age", "sex_male": "Male sex", "typical_cp": "Typical angina", "atypical": "Atypical chest pain",
          "nonanginal": "Non-anginal chest pain", "bp": "Resting systolic BP", "fbs_high": "Fasting sugar >120 mg/dL",
          "ecg_stt": "ECG ST-T abnormality", "lvh": "ECG LVH", "tchol": "Total cholesterol"}
COHORTS = ["Cleveland", "Hungary", "Switzerland", "VA Long Beach"]


def zas_frame():
    raw = load_raw(ZAS)
    X, Y = encode_inputs(raw), encode_targets(raw)
    assert not set(LEAKAGE_COLUMNS) & set(X.columns)
    f = pd.DataFrame({
        "age": X["age"], "sex_male": X["sex_male"],
        "typical_cp": X["typical_cp"], "atypical": X["atypical"], "nonanginal": X["nonanginal"],
        "bp": X["bp"], "fbs_high": (X["fbs"] > 120).astype(float),
        "ecg_stt": ((X["st_elevation"] + X["st_depression"] + X["t_inversion"]) > 0).astype(float),
        "lvh": X["lvh"], "tchol": X["ldl"] + X["hdl"] + X["tg"] / 5.0,
    })
    return f[COLS].astype(float), Y["CAD"].astype(int).values


def uci_frame():
    d = pd.read_csv(UCI)
    cp = d["cp"].str.lower()
    f = pd.DataFrame({
        "age": d["age"], "sex_male": (d["sex"] == "Male").astype(float),
        "typical_cp": (cp == "typical angina").astype(float), "atypical": (cp == "atypical angina").astype(float),
        "nonanginal": (cp == "non-anginal").astype(float),
        "bp": d["trestbps"].replace(0, np.nan),
        "fbs_high": d["fbs"].map({True: 1.0, False: 0.0, "TRUE": 1.0, "FALSE": 0.0}),
        "ecg_stt": d["restecg"].map({"st-t abnormality": 1.0, "normal": 0.0, "lv hypertrophy": 0.0}),
        "lvh": d["restecg"].map({"lv hypertrophy": 1.0, "normal": 0.0, "st-t abnormality": 0.0}),
        "tchol": d["chol"].replace(0, np.nan),
    })
    return f[COLS].astype(float), (d["num"] > 0).astype(int).values, d["dataset"].values


def model(seed=SEED):
    pipe = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=5000))
    grid = {"logisticregression__C": [0.01, 0.03, 0.1, 0.3, 1.0, 3.0]}
    return GridSearchCV(pipe, grid, cv=StratifiedKFold(5, shuffle=True, random_state=seed), scoring="roc_auc")


def boot_auc(y, p, n=2000, seed=SEED):
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() != y[i].max():
            out.append(roc_auc_score(y[i], p[i]))
    return [float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))]


def calib(y, p):
    """Calibration-in-the-large and slope by logistic recalibration of logit(p)."""
    lp = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    m = LogisticRegression(C=1e6, max_iter=5000).fit(lp.reshape(-1, 1), y)
    return float(m.intercept_[0]), float(m.coef_[0, 0])


def metrics(y, p, thr):
    yhat = (p >= thr).astype(int)
    tp, tn = int(((yhat == 1) & (y == 1)).sum()), int(((yhat == 0) & (y == 0)).sum())
    pos, neg = int(y.sum()), int((1 - y).sum())
    out = {"n": int(len(y)), "positives": pos, "prevalence": float(y.mean()), "mean_predicted": float(p.mean()),
           "accuracy": float((yhat == y).mean()), "sensitivity": tp / pos if pos else None,
           "specificity": tn / neg if neg else None, "brier": float(brier_score_loss(y, p))}
    if 0 < pos < len(y):
        out["auc"] = float(roc_auc_score(y, p))
        out["auc_ci95"] = boot_auc(y, p)
        out["calibration_intercept"], out["calibration_slope"] = calib(y, p)
    return out


def main():
    Xz, yz = zas_frame()
    Xu, yu, cohort = uci_frame()

    # 1) internal estimate of the reduced model: 5x5 repeated nested CV on Z-Alizadeh Sani
    aucs = []
    for k, (tr, te) in enumerate(RepeatedStratifiedKFold(n_splits=5, n_repeats=5, random_state=SEED).split(Xz, yz)):
        m = model(SEED + k).fit(Xz.iloc[tr], yz[tr])
        aucs.append(roc_auc_score(yz[te], m.predict_proba(Xz.iloc[te])[:, 1]))

    # 2) final reduced model on ALL Z-Alizadeh Sani; threshold = Youden on its own out-of-fold predictions
    final = model().fit(Xz, yz)
    oof = cross_val_predict(model(), Xz, yz, cv=StratifiedKFold(5, shuffle=True, random_state=SEED),
                            method="predict_proba")[:, 1]
    fpr, tpr, thr = roc_curve(yz, oof)
    t = float(thr[np.argmax(tpr - fpr)])

    # 3) external test: never seen in training, imputation uses Z-Alizadeh Sani medians only
    pu = final.predict_proba(Xu)[:, 1]
    ext = {"pooled": metrics(yu, pu, t)}
    for c in COHORTS:
        ext[c] = metrics(yu[cohort == c], pu[cohort == c], t)

    # 4) reference: same features, model trained AND cross-validated inside UCI (what these features can do there)
    native = cross_val_predict(model(), Xu, yu, cv=StratifiedKFold(5, shuffle=True, random_state=SEED),
                               method="predict_proba")[:, 1]

    # 5) without cholesterol (Switzerland has none recorded at all)
    cols2 = [c for c in COLS if c != "tchol"]
    f2 = model().fit(Xz[cols2], yz)
    p2 = f2.predict_proba(Xu[cols2])[:, 1]

    lr = final.best_estimator_.named_steps["logisticregression"]
    res = {
        "source_sha256": hashlib.sha256(UCI.read_bytes()).hexdigest(),
        "features": [LABELS[c] for c in COLS],
        "missing_in_external": {LABELS[c]: int(Xu[c].isna().sum()) for c in COLS if Xu[c].isna().any()},
        "train": {"dataset": "Z-Alizadeh Sani", "n": int(len(yz)), "prevalence": float(yz.mean())},
        "internal_nested_cv_auc": [float(np.mean(aucs)), float(np.std(aucs))],
        "threshold": t,
        "external": ext,
        "external_without_cholesterol_auc": float(roc_auc_score(yu, p2)),
        "native_uci_cv_auc": float(roc_auc_score(yu, native)),
        "coefficients_per_sd": {LABELS[c]: float(w) for c, w in zip(COLS, lr.coef_[0])},
        "note": "Overall CAD only; UCI cohorts do not record which artery is narrowed. `ca` and exercise-test "
                "variables excluded. Missing values imputed with training (Z-Alizadeh Sani) medians.",
    }
    OUT.write_text(json.dumps(res, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k not in ("coefficients_per_sd",)}, indent=1))
    print(json.dumps(res["coefficients_per_sd"], indent=1))


if __name__ == "__main__":
    main()
