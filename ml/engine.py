"""Reference inference engine over the exported JSON bundle.

This is the *same arithmetic* as frontend/src/lib/engine.ts. The FastAPI backend uses it, and
tests/test_parity.py checks (a) engine == CardioModel/sklearn and (b) the TypeScript engine == this
engine on every dataset patient.
"""
from __future__ import annotations

import math
from typing import Any

N_IG = 48  # integration points for term-space integrated gradients (midpoint rule)


def _sig(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def _logit(p: float, eps: float = 1e-9) -> float:
    p = min(max(p, eps), 1 - eps)
    return math.log(p / (1 - p))


def _bisect_right(a: list, x: float) -> int:
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if x < a[mid]:
            hi = mid
        else:
            lo = mid + 1
    return lo


def term_value(t: dict, x: Any) -> float:
    if t["kind"] == "lin":
        return t["w"] * (float(x) - t["x0"])
    if t["kind"] == "bins":
        return t["scores"][_bisect_right(t["cuts"], float(x))]
    return t["map"].get(str(x), 0.0)


def additive(model: dict, x: dict):
    """-> (raw score, reference raw score, centred per-feature contributions)"""
    contrib, ref, score = {}, model["intercept"], model["intercept"]
    for t in model["terms"]:
        v = term_value(t, x[t["key"]])
        m = model["means"][t["key"]]
        score += v
        ref += m
        contrib[t["key"]] = v - m
    return score, ref, contrib


def _quantile(xs: list, q: float) -> float:
    s = sorted(xs)
    if not s:
        return float("nan")
    pos = q * (len(s) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def conformal_set(p: float, q: list) -> list:
    out = []
    if p <= q[0] + 1e-12:
        out.append(0)
    if 1 - p <= q[1] + 1e-12:
        out.append(1)
    return out


def predict(bundle: dict, x: dict) -> dict:
    T = bundle["targets"]
    res, att = {}, {}

    # ---- CAD (direct)
    def direct(name):
        t = T[name]
        a, b = t["calib"]
        s, r, c = additive(t["model"], x)
        L, L0 = a * s + b, a * r + b
        att[name] = {"base": L0, "value": L, "contributions": {k: a * v for k, v in c.items()}}
        boot = [_sig(a * additive(m, x)[0] + b) for m in t.get("boot", [])]
        return _sig(L), boot, (L, L0, {k: a * v for k, v in c.items()})

    p_cad, boot_cad, (Lc, Lc0, cc) = direct("CAD")
    res["CAD"] = p_cad
    boots = {"CAD": boot_cad}

    for v in ("LAD", "LCX", "RCA"):
        t = T[v]
        if t["structure"] == "direct":
            res[v], boots[v], _ = direct(v)
            continue
        a, b = t["calib"]
        s, r, c = additive(t["model"], x)
        Lv, Lv0 = a * s + b, a * r + b
        cv = {k: a * val for k, val in c.items()}
        p = p_cad * _sig(Lv)
        res[v] = p
        # bootstrap pairs (CAD boot i, conditional boot i)
        bc = boot_cad
        bv = [_sig(a * additive(m, x)[0] + b) for m in t.get("boot", [])]
        boots[v] = [bc[i] * bv[i] for i in range(min(len(bc), len(bv)))]
        # term-space integrated gradients for h = logit(sig(L1) * sig(L2))
        dL1, dL2 = Lc - Lc0, Lv - Lv0
        g1 = g2 = 0.0
        for i in range(N_IG):
            al = (i + 0.5) / N_IG
            s1, s2 = _sig(Lc0 + al * dL1), _sig(Lv0 + al * dL2)
            P = s1 * s2
            g1 += (1 - s1) / (1 - P)
            g2 += (1 - s2) / (1 - P)
        g1 /= N_IG
        g2 /= N_IG
        base = _logit(_sig(Lc0) * _sig(Lv0))
        val = _logit(p)
        contrib = {k: cc[k] * g1 + cv[k] * g2 for k in cc}
        # distribute the (tiny) quadrature residual proportionally so contributions sum exactly
        resid = (val - base) - sum(contrib.values())
        tot = sum(abs(z) for z in contrib.values()) or 1.0
        contrib = {k: z + resid * abs(z) / tot for k, z in contrib.items()}
        att[v] = {"base": base, "value": val, "contributions": contrib}

    out = {}
    for k, p in res.items():
        t = T[k]
        bs = [_logit(q) for q in (boots.get(k) or [])]
        if bs:  # centred percentile interval: spread of the bootstrap logits around their own mean
            mu = sum(bs) / len(bs)
            dev = [z - mu for z in bs]
            lo, hi = _sig(_logit(p) + _quantile(dev, 0.05)), _sig(_logit(p) + _quantile(dev, 0.95))
        else:
            lo, hi = p, p
        out[k] = {"p": p, "lo": min(lo, p), "hi": max(hi, p), "set": conformal_set(p, t["conformal"]),
                  "threshold": t["threshold"], "positive": p >= t["threshold"]}
    return {"targets": out, "attributions": att}
