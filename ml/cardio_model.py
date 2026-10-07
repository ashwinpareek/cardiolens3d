"""CardioModel: the complete, self-contained prediction pipeline.

One object = everything needed to go from raw clinical inputs to the numbers the UI shows:

  * per-target additive ("glass-box") scorer:  F(x) = b0 + sum_j f_j(x_j)
      - family 'logreg'  : f_j linear (L2/L1 logistic regression on standardised inputs)
      - family 'ebm'     : f_j piecewise-constant shape functions (Explainable Boosting Machine)
  * structure 'direct'       : P(target) = sigmoid(a*F + b)                       (Platt-calibrated)
    structure 'hierarchical' : P(vessel) = P(CAD) * P(vessel | CAD)               (anatomically consistent:
                               P(vessel) <= P(CAD) always, mirroring "stenosis in a vessel => CAD")
  * operating threshold (Youden J on inner out-of-fold predictions)
  * Mondrian (class-conditional) split-conformal quantiles -> prediction sets with 1-alpha coverage
  * bootstrap ensemble -> 90% interval on each probability
  * exact feature attributions:
      - direct targets: interventional SHAP of an additive model, phi_j = a * (f_j(x_j) - E[f_j(X_j)])
        (exact, not sampled; identical to shap.LinearExplainer for the logistic family)
      - hierarchical targets: Aumann-Shapley / integrated-gradients in term space over the two
        additive factors -> attributions on the vessel log-odds that sum exactly to
        (patient log-odds - reference log-odds)

Every statistic is learned from the data passed to fit() only, so fitting a CardioModel inside each
outer CV fold gives a leakage-free estimate of the *entire* pipeline, not just the classifier.

The model is exported to a plain-JSON "bundle" (export_bundle) that both the Python backend and the
in-browser engine evaluate with identical arithmetic (parity is unit-tested).
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_curve
from sklearn.model_selection import GridSearchCV, StratifiedKFold

from features import FEATURES, TARGET_IDS
from models import CATEGORICAL, NUMERIC, SEED, candidates

FAMILY_TO_CANDIDATE = {"logreg_l2": "logreg_l2", "logreg_l1": "logreg_l1", "ebm": "ebm"}
BBB_LEVELS = ["N", "LBBB", "RBBB"]


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def logit(p, eps=1e-6):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


# ============================================================================ additive export
def additive_from_pipeline(pipe, X_background: pd.DataFrame) -> dict:
    """Turn a fitted sklearn pipeline (logreg or EBM) into {intercept, terms, means}."""
    prep, clf = pipe.named_steps["prep"], pipe.named_steps["clf"]
    terms = []
    if isinstance(clf, LogisticRegression):
        sc = prep.named_transformers_["num"]
        w = clf.coef_.ravel()
        for i, k in enumerate(NUMERIC):
            terms.append({"key": k, "kind": "lin", "w": float(w[i] / sc.scale_[i]), "x0": float(sc.mean_[i])})
        wl, wr = float(w[len(NUMERIC)]), float(w[len(NUMERIC) + 1])
        terms.append({"key": "bbb", "kind": "cat", "map": {"N": 0.0, "LBBB": wl, "RBBB": wr}})
        intercept = float(clf.intercept_[0])
    else:  # EBM
        cuts = [np.asarray(clf.bins_[i][0], dtype=float) for i in range(len(clf.term_names_))]
        sc = [np.asarray(clf.term_scores_[i], dtype=float) for i in range(len(clf.term_names_))]
        for i, k in enumerate(NUMERIC):
            terms.append({"key": k, "kind": "bins", "cuts": cuts[i].tolist(), "scores": sc[i][1:-1].tolist()})
        iL, iR = len(NUMERIC), len(NUMERIC) + 1

        def at(i, v):
            return float(sc[i][1:-1][np.searchsorted(cuts[i], v, side="right")])
        terms.append({"key": "bbb", "kind": "cat", "map": {
            "N": at(iL, 0) + at(iR, 0), "LBBB": at(iL, 1) + at(iR, 0), "RBBB": at(iL, 0) + at(iR, 1)}})
        intercept = float(np.ravel(clf.intercept_)[0])
    model = {"intercept": intercept, "terms": terms}
    contrib = term_values(model, X_background)
    model["means"] = {t["key"]: float(contrib[:, j].mean()) for j, t in enumerate(terms)}
    return model


def term_values(model: dict, X: pd.DataFrame) -> np.ndarray:
    out = np.zeros((len(X), len(model["terms"])))
    for j, t in enumerate(model["terms"]):
        x = X[t["key"]].values
        if t["kind"] == "lin":
            out[:, j] = t["w"] * (x.astype(float) - t["x0"])
        elif t["kind"] == "bins":
            idx = np.searchsorted(np.asarray(t["cuts"]), x.astype(float), side="right")
            out[:, j] = np.asarray(t["scores"])[idx]
        else:
            out[:, j] = [t["map"].get(str(v), 0.0) for v in x]
    return out


def additive_score(model: dict, X: pd.DataFrame) -> np.ndarray:
    return model["intercept"] + term_values(model, X).sum(1)


def additive_centered(model: dict, X: pd.DataFrame):
    """(reference score, per-term centred contributions) with reference = background mean."""
    tv = term_values(model, X)
    means = np.array([model["means"][t["key"]] for t in model["terms"]])
    return model["intercept"] + means.sum(), tv - means


# ============================================================================ fitting helpers
def _grid_fit(family: str, X, y, seed=SEED):
    """Inner-CV model selection. family may be a single family or 'auto:a,b,c' in which case the
    algorithm itself is chosen by inner-CV ROC-AUC (so it is part of the nested loop too)."""
    fams = family.split(":", 1)[1].split(",") if family.startswith("auto:") else [family]
    best = None
    for fam in fams:
        pipe, grid = candidates()[FAMILY_TO_CANDIDATE[fam]]
        gs = GridSearchCV(clone(pipe), grid, scoring="roc_auc",
                          cv=StratifiedKFold(5, shuffle=True, random_state=seed), n_jobs=1)
        gs.fit(X, y)
        if best is None or gs.best_score_ > best[2] + 1e-9:
            best = (gs.best_estimator_, {"family": fam, **gs.best_params_}, gs.best_score_)
    return best[0], best[1]


def _raw(pipe, X):
    return np.asarray(pipe.decision_function(X), dtype=float)


def _platt(score, y):
    lr = LogisticRegression(C=1e4, max_iter=1000).fit(score.reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def youden(y, p):
    fpr, tpr, thr = roc_curve(y, p)
    j = np.argmax(tpr - fpr)
    return float(np.clip(thr[j], 0.02, 0.98))


def conformal_q(y, p, alpha):
    """Mondrian split-conformal: per-class quantile of nonconformity s = 1 - p(true class)."""
    q = []
    for c in (0, 1):
        s = np.sort(1 - (p[y == c] if c == 1 else 1 - p[y == c]))
        n = len(s)
        k = int(np.ceil((n + 1) * (1 - alpha)))
        q.append(float(s[min(k, n) - 1]) if n else 1.0)
    return q


def conformal_set(p, q):
    s1, s0 = 1 - p, p  # nonconformity of labels 1 and 0
    return [c for c, ok in ((0, s0 <= q[0] + 1e-12), (1, s1 <= q[1] + 1e-12)) if ok]


# ============================================================================ model
@dataclass
class TargetSpec:
    family: str = "logreg_l2"
    structure: str = "direct"   # or "hierarchical"


DEFAULT_SPEC = {"CAD": TargetSpec("logreg_l2"), "LAD": TargetSpec("logreg_l2", "hierarchical"),
                "LCX": TargetSpec("logreg_l2", "hierarchical"), "RCA": TargetSpec("logreg_l2", "hierarchical")}


class CardioModel:
    def __init__(self, spec: dict | None = None, alpha: float = 0.10, n_boot: int = 0, seed: int = SEED):
        self.spec = copy.deepcopy(spec or DEFAULT_SPEC)
        self.alpha, self.n_boot, self.seed = alpha, n_boot, seed
        self.t: dict = {}

    # ------------------------------------------------------------------ fit
    def fit(self, X: pd.DataFrame, Y: pd.DataFrame):
        X = X.reset_index(drop=True)
        Y = Y.reset_index(drop=True)
        self.background = X.copy()
        ycad = Y["CAD"].values
        inner = StratifiedKFold(5, shuffle=True, random_state=self.seed + 1)

        # ---- CAD (always direct; it is the parent of the hierarchical vessels)
        self.t["CAD"] = self._fit_direct("CAD", X, ycad, inner)
        cad_oof = self.t["CAD"]["_oof_logit"]

        for v in ["LAD", "LCX", "RCA"]:
            yv = Y[v].values
            if self.spec[v].structure == "direct":
                self.t[v] = self._fit_direct(v, X, yv, inner)
            else:
                self.t[v] = self._fit_hier(v, X, ycad, yv, inner, cad_oof)
        for k in self.t:
            self.t[k].pop("_oof_logit", None)
        return self

    def _fit_direct(self, name, X, y, inner):
        fam = self.spec[name].family
        est, params = _grid_fit(fam, X, y, self.seed)
        oof = np.zeros(len(y))
        for tr, te in inner.split(X, y):
            m = clone(est).fit(X.iloc[tr], y[tr])
            oof[te] = _raw(m, X.iloc[te])
        a, b = _platt(oof, y)
        p_oof = sigmoid(a * oof + b)
        out = dict(structure="direct", family=params["family"], params={k: str(v) for k, v in params.items()},
                   pipe=est, model=additive_from_pipeline(est, X), calib=[a, b],
                   threshold=youden(y, p_oof), conformal=conformal_q(y, p_oof, self.alpha),
                   _oof_logit=a * oof + b)
        out["boot"] = self._boot(est, X, y) if self.n_boot else []
        return out

    def _fit_hier(self, name, X, ycad, yv, inner, cad_oof_logit):
        fam = self.spec[name].family
        pos = np.where(ycad == 1)[0]
        Xp, yp = X.iloc[pos].reset_index(drop=True), yv[pos]
        est, params = _grid_fit(fam, Xp, yp, self.seed)
        # out-of-fold conditional score for *every* training row (conditional model only ever
        # trained on CAD-positive rows of the inner-training part)
        oof = np.zeros(len(yv))
        for tr, te in inner.split(X, yv):
            trp = tr[ycad[tr] == 1]
            m = clone(est).fit(X.iloc[trp], yv[trp])
            oof[te] = _raw(m, X.iloc[te])
        a, b = _platt(oof[pos], yp)  # calibrated on CAD-positive rows, where the conditional is defined
        p_oof = sigmoid(cad_oof_logit) * sigmoid(a * oof + b)
        out = dict(structure="hierarchical", parent="CAD", family=params["family"],
                   params={k: str(v) for k, v in params.items()}, pipe=est,
                   model=additive_from_pipeline(est, X), calib=[a, b],
                   threshold=youden(yv, p_oof), conformal=conformal_q(yv, p_oof, self.alpha))
        out["boot"] = self._boot(est, Xp, yp) if self.n_boot else []
        return out

    def _boot(self, est, X, y):
        """Bootstrap refits (fixed hyper-parameters) -> additive models for interval estimates."""
        rng = np.random.default_rng(self.seed)
        reps = []
        while len(reps) < self.n_boot:
            idx = rng.integers(0, len(y), len(y))
            if len(np.unique(y[idx])) < 2:
                continue
            m = clone(est).fit(X.iloc[idx], y[idx])
            add = additive_from_pipeline(m, self.background)
            reps.append(add)
        return reps

    # ------------------------------------------------------------------ predict (bundle arithmetic)
    def _logit(self, name, X, model=None):
        t = self.t[name]
        a, b = t["calib"]
        return a * additive_score(model or t["model"], X) + b

    def predict_proba(self, X: pd.DataFrame) -> dict:
        out = {"CAD": sigmoid(self._logit("CAD", X))}
        for v in ["LAD", "LCX", "RCA"]:
            p = sigmoid(self._logit(v, X))
            out[v] = out["CAD"] * p if self.t[v]["structure"] == "hierarchical" else p
        return out

    def predict_proba_sklearn(self, X: pd.DataFrame) -> dict:
        """Same probabilities computed through the original sklearn/interpret pipelines
        (decision_function), independent of the exported additive representation."""
        def L(name):
            a, b = self.t[name]["calib"]
            return a * np.asarray(self.t[name]["pipe"].decision_function(X), dtype=float) + b
        out = {"CAD": sigmoid(L("CAD"))}
        for v in ["LAD", "LCX", "RCA"]:
            p = sigmoid(L(v))
            out[v] = out["CAD"] * p if self.t[v]["structure"] == "hierarchical" else p
        return out

    # ------------------------------------------------------------------ export
    def export_bundle(self) -> dict:
        tg = {}
        for k, t in self.t.items():
            tg[k] = {kk: t[kk] for kk in ("structure", "family", "params", "model", "calib", "threshold", "conformal", "boot")}
            if t["structure"] == "hierarchical":
                tg[k]["parent"] = "CAD"
        return {"alpha": self.alpha, "targets": tg}
