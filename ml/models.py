"""Candidate model zoo + preprocessing.

Every candidate is a full sklearn Pipeline (preprocessing + estimator), so all
learned statistics (scaling means/variances, one-hot categories) are fit inside
each training fold only. This is what makes the cross-validation leakage-free.
"""
from __future__ import annotations

import warnings

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC

from features import FEATURES

warnings.filterwarnings("ignore", category=UserWarning)

NUMERIC = [f.key for f in FEATURES if f.kind in ("numeric", "ordinal", "binary")]
CATEGORICAL = [f.key for f in FEATURES if f.kind == "categorical"]
SEED = 42


def preprocessor(scale: bool = True) -> ColumnTransformer:
    return ColumnTransformer(
        [
            ("num", StandardScaler() if scale else "passthrough", NUMERIC),
            ("cat", OneHotEncoder(categories=[["N", "LBBB", "RBBB"]], drop="first",
                                  handle_unknown="ignore", sparse_output=False), CATEGORICAL),
        ],
        verbose_feature_names_out=False,
    )


def transformed_feature_names() -> list[str]:
    return NUMERIC + ["bbb_LBBB", "bbb_RBBB"]


def _lgbm(**kw):
    from lightgbm import LGBMClassifier
    return LGBMClassifier(objective="binary", learning_rate=0.03, num_leaves=7, max_depth=3,
                          min_child_samples=15, subsample=0.8, subsample_freq=1, colsample_bytree=0.6,
                          reg_lambda=2.0, n_estimators=300, random_state=SEED, verbose=-1, n_jobs=1, **kw)


def _xgb(**kw):
    from xgboost import XGBClassifier
    return XGBClassifier(n_estimators=300, learning_rate=0.03, max_depth=2, subsample=0.8,
                         colsample_bytree=0.6, reg_lambda=2.0, min_child_weight=2, eval_metric="logloss",
                         random_state=SEED, n_jobs=1, **kw)


def _cat(**kw):
    from catboost import CatBoostClassifier
    return CatBoostClassifier(iterations=500, learning_rate=0.03, depth=4, l2_leaf_reg=5,
                              random_seed=SEED, verbose=False, thread_count=1, **kw)


def _ebm(**kw):
    from interpret.glassbox import ExplainableBoostingClassifier
    return ExplainableBoostingClassifier(interactions=0, outer_bags=8, inner_bags=0, max_bins=32,
                                         learning_rate=0.02, min_samples_leaf=4, smoothing_rounds=200,
                                         random_state=SEED, n_jobs=1, **kw)


def candidates() -> dict:
    """name -> (pipeline, inner-CV hyper-parameter grid)."""
    return {
        "logreg_l2": (
            Pipeline([("prep", preprocessor()),
                      ("clf", LogisticRegression(max_iter=5000, class_weight="balanced"))]),
            {"clf__C": [0.01, 0.03, 0.1, 0.3, 1.0]},
        ),
        "logreg_l1": (
            Pipeline([("prep", preprocessor()),
                      ("clf", LogisticRegression(penalty="l1", solver="liblinear", max_iter=5000, random_state=SEED,
                                                 class_weight="balanced"))]),
            {"clf__C": [0.03, 0.1, 0.3, 1.0]},
        ),
        "svm_rbf": (
            Pipeline([("prep", preprocessor()),
                      ("clf", SVC(kernel="rbf", probability=True, class_weight="balanced", random_state=SEED))]),
            {"clf__C": [0.3, 1.0, 3.0], "clf__gamma": ["scale", 0.005]},
        ),
        "random_forest": (
            Pipeline([("prep", preprocessor(scale=False)),
                      ("clf", RandomForestClassifier(n_estimators=400, class_weight="balanced_subsample",
                                                     random_state=SEED, n_jobs=1))]),
            {"clf__max_features": ["sqrt", 0.3], "clf__min_samples_leaf": [1, 4]},
        ),
        "extra_trees": (
            Pipeline([("prep", preprocessor(scale=False)),
                      ("clf", ExtraTreesClassifier(n_estimators=400, class_weight="balanced_subsample",
                                                   random_state=SEED, n_jobs=1))]),
            {"clf__max_features": ["sqrt", 0.3], "clf__min_samples_leaf": [1, 4]},
        ),
        "lightgbm": (
            Pipeline([("prep", preprocessor(scale=False)), ("clf", _lgbm())]),
            {"clf__n_estimators": [150, 350], "clf__num_leaves": [4, 7]},
        ),
        "xgboost": (
            Pipeline([("prep", preprocessor(scale=False)), ("clf", _xgb())]),
            {"clf__n_estimators": [150, 350], "clf__max_depth": [2, 3]},
        ),
        "ebm": (
            Pipeline([("prep", preprocessor(scale=False)), ("clf", _ebm())]),
            {"clf__max_leaves": [2, 3]},
        ),
        "catboost": (
            Pipeline([("prep", preprocessor(scale=False)), ("clf", _cat())]),
            {"clf__depth": [3, 5]},
        ),
    }
