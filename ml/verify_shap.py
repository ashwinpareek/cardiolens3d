"""Cross-check our closed-form attributions against the `shap` library.

CAD (additive logistic):  ours == shap.LinearExplainer (interventional, training background)  -> exact
Vessels (hierarchical):   ours (term-space integrated gradients, log-odds) vs shap.KernelExplainer on the
                          same log-odds function -> correlation / agreement of top features
Writes results/shap_check.json
"""
import json
import warnings

import joblib
import numpy as np
import shap

import engine
from features import encode_inputs, load_raw
from train_final import ART, DATA, RES

warnings.filterwarnings("ignore")
m = joblib.load(ART / "cardiolens_model.joblib")["model"]
bundle = json.loads((ART / "model_bundle.json").read_text())
X = encode_inputs(load_raw(DATA))
rng = np.random.default_rng(0)
idx = rng.choice(len(X), 25, replace=False)
out = {}

# ---- CAD: LinearExplainer on the logistic model in standardised space, scaled by the Platt slope
t = m.t["CAD"]
pipe = t["pipe"]
Z = pipe.named_steps["prep"].transform(X)
clf = pipe.named_steps["clf"]
le = shap.LinearExplainer(clf, shap.maskers.Independent(Z, max_samples=len(Z)))
sv = le.shap_values(Z[idx]) * t["calib"][0]
names = pipe.named_steps["prep"].get_feature_names_out()
ours = np.array([[engine.predict(bundle, X.iloc[i].to_dict())["attributions"]["CAD"]["contributions"][k]
                  for k in names if not k.startswith("bbb")] for i in idx])
theirs = sv[:, [j for j, k in enumerate(names) if not k.startswith("bbb")]]
out["CAD_linear_max_abs_diff"] = float(np.abs(ours - theirs).max())
print("CAD vs shap.LinearExplainer: max |diff| =", out["CAD_linear_max_abs_diff"])

# ---- vessels: KernelSHAP on the log-odds of the hierarchical probability
keys = list(X.columns)
num = [k for k in keys if k != "bbb"]
bg = X[num].mean().to_frame().T  # same reference point as our attributions (training mean)


import pandas as pd


def f(A, v):  # vectorised log-odds of the hierarchical vessel probability
    D = pd.DataFrame(A, columns=num)
    D["bbb"] = "N"
    p = np.clip(m.predict_proba(D[keys])[v], 1e-9, 1 - 1e-9)
    return np.log(p / (1 - p))


for v in ("LAD", "LCX", "RCA"):
    ke = shap.KernelExplainer(lambda A: f(A, v), bg.values)
    corr, top_agree = [], []
    for i in idx[:12]:
        x = X.iloc[i].copy()
        x["bbb"] = "N"
        ks = ke.shap_values(x[num].values.astype(float), nsamples=1500, silent=True)
        ig = engine.predict(bundle, x.to_dict())["attributions"][v]["contributions"]
        ig = np.array([ig[k] for k in num])
        corr.append(np.corrcoef(ks, ig)[0, 1])
        top_agree.append(len(set(np.argsort(-np.abs(ks))[:5]) & set(np.argsort(-np.abs(ig))[:5])) / 5)
    out[v] = {"pearson_r_mean": float(np.mean(corr)), "top5_overlap_mean": float(np.mean(top_agree))}
    print(v, out[v])
(RES / "shap_check.json").write_text(json.dumps(out, indent=1))
