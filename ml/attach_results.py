"""Attach the external-validation and split-optimism results to the model card (and the app data),
without retraining. train_final.py calls the same function, so a full `make train` includes them too.

    python ml/attach_results.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES, ART, WEB = ROOT / "ml" / "results", ROOT / "ml" / "artifacts", ROOT / "frontend" / "public" / "data"


def extra_results() -> dict:
    out = {}
    ev = RES / "external_validation.json"
    if ev.exists():
        out["external"] = {k: v for k, v in json.loads(ev.read_text()).items() if k != "source_sha256"}
    so = RES / "split_optimism.json"
    if so.exists():
        out["split_optimism"] = {k: v for k, v in json.loads(so.read_text()).items() if k != "rows"}
    return out


def main():
    extra = extra_results()
    card = json.loads((ART / "model_card.json").read_text())
    card.update(extra)
    (ART / "model_card.json").write_text(json.dumps(card, indent=1))
    app = json.loads((WEB / "app_data.json").read_text())
    app["card"].update(extra)
    (WEB / "app_data.json").write_text(json.dumps(app, separators=(",", ":")))
    print("attached:", ", ".join(extra) or "nothing")


if __name__ == "__main__":
    main()
