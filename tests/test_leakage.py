"""The four angiography columns are the answers. They must never reach the model, in any form."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))

from features import FEATURE_KEYS, LEAKAGE_COLUMNS, encode_inputs, load_raw  # noqa: E402

LEAK = {c.lower() for c in LEAKAGE_COLUMNS} | {"cath"}


def _keys_in(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k).lower()
            yield from _keys_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys_in(v)


def test_leakage_list_is_complete():
    assert {c.lower() for c in LEAKAGE_COLUMNS} == {"lad", "lcx", "rca", "cath"}


def test_feature_registry_has_no_leakage():
    assert not LEAK & {k.lower() for k in FEATURE_KEYS}


def test_encoded_training_matrix_has_no_leakage():
    X = encode_inputs(load_raw(ROOT / "data" / "z_alizadeh_sani_extension.xlsx"))
    assert not LEAK & {c.lower() for c in X.columns}
    assert len(X.columns) == len(FEATURE_KEYS) == 54


def test_exported_model_terms_have_no_leakage():
    bundle = json.loads((ROOT / "ml" / "artifacts" / "model_bundle.json").read_text())
    for t in bundle["targets"].values():
        terms = {term["key"].lower() for term in t["model"]["terms"]}
        assert not LEAK & terms
        for b in t.get("boot", []):
            assert not LEAK & {term["key"].lower() for term in b["terms"]}


def test_app_input_schema_has_no_leakage():
    app = json.loads((ROOT / "frontend" / "public" / "data" / "app_data.json").read_text())
    assert not LEAK & {f["key"].lower() for f in app["features"]}
    # dataset patients carry angiography only as `labels` (shown as ground truth), never as inputs
    for p in app["patients"][:50]:
        assert not LEAK & {k.lower() for k in p["inputs"]}


def test_external_validation_excludes_ca_and_exercise_test():
    import external_validation as ev
    assert not {"ca", "thal", "thalch", "exang", "oldpeak", "slope"} & set(ev.COLS)
