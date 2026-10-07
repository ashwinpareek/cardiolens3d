"""Feature registry for the Z-Alizadeh Sani extension dataset.

This module is the single source of truth for every clinical input the system
understands. The backend, the training pipeline and the frontend form are all
generated from FEATURES, so adding a new clinical variable means adding one
entry here (plus the column in the data) -- nothing else needs redesign.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Optional

import numpy as np
import pandas as pd

# Columns that are (or directly encode) the targets. They are NEVER model inputs.
LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]

TARGETS = {
    # target id -> (source column, positive value, human label)
    "CAD": ("Cath", "CAD", "Overall coronary artery disease"),
    "LAD": ("LAD", "Stenotic", "Left anterior descending stenosis"),
    "LCX": ("LCX", "Stenotic", "Left circumflex stenosis"),
    "RCA": ("RCA", "Stenotic", "Right coronary artery stenosis"),
}
TARGET_IDS = list(TARGETS)


@dataclass
class Feature:
    key: str                 # internal snake_case key used by API + models
    column: str              # raw column name in the dataset
    label: str               # display label
    group: str               # Demographics | History | Symptoms & Exam | ECG | Laboratory | Echocardiography
    kind: str                # "binary" | "numeric" | "ordinal" | "categorical"
    unit: str = ""
    normal: Optional[tuple] = None      # (low, high) reference range for numeric labs/vitals
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    step: Optional[float] = None
    options: Optional[list] = None      # for ordinal / categorical: list of (value, label)
    modifiable: bool = False            # can lifestyle / treatment plausibly change it
    description: str = ""


def _yn(key, column, label, group, description="", modifiable=False):
    return Feature(key, column, label, group, "binary", options=[[0, "No"], [1, "Yes"]],
                   modifiable=modifiable, description=description)


FEATURES: list[Feature] = [
    # ---------------- Demographics / anthropometrics
    Feature("age", "Age", "Age", "Demographics", "numeric", "years", None, 18, 95, 1),
    Feature("sex_male", "Sex", "Sex", "Demographics", "binary", options=[[0, "Female"], [1, "Male"]]),
    Feature("weight", "Weight", "Weight", "Demographics", "numeric", "kg", None, 35, 150, 1, modifiable=True),
    Feature("height", "Length", "Height", "Demographics", "numeric", "cm", None, 130, 200, 1),
    Feature("bmi", "BMI", "BMI", "Demographics", "numeric", "kg/m²", (18.5, 24.9), 14, 45, 0.1, modifiable=True,
            description="Recomputed from weight and height when either is edited."),
    # ---------------- History / risk factors
    _yn("dm", "DM", "Diabetes mellitus", "History", modifiable=True),
    _yn("htn", "HTN", "Hypertension", "History", modifiable=True),
    _yn("current_smoker", "Current Smoker", "Current smoker", "History", modifiable=True),
    _yn("ex_smoker", "EX-Smoker", "Ex-smoker", "History"),
    _yn("fh", "FH", "Family history of CAD", "History"),
    _yn("obesity", "Obesity", "Obesity (BMI > 25)", "History", modifiable=True),
    _yn("crf", "CRF", "Chronic renal failure", "History"),
    _yn("cva", "CVA", "Prior stroke (CVA)", "History"),
    _yn("airway", "Airway disease", "Airway disease", "History"),
    _yn("thyroid", "Thyroid Disease", "Thyroid disease", "History"),
    _yn("chf", "CHF", "Congestive heart failure", "History"),
    _yn("dlp", "DLP", "Dyslipidemia", "History", modifiable=True),
    # ---------------- Symptoms & physical exam
    Feature("bp", "BP", "Blood pressure (systolic)", "Symptoms & Exam", "numeric", "mmHg", (90, 130), 80, 220, 1,
            modifiable=True),
    Feature("pr", "PR", "Pulse rate", "Symptoms & Exam", "numeric", "bpm", (60, 100), 40, 140, 1, modifiable=True),
    _yn("edema", "Edema", "Edema", "Symptoms & Exam"),
    _yn("weak_pulse", "Weak Peripheral Pulse", "Weak peripheral pulse", "Symptoms & Exam"),
    _yn("lung_rales", "Lung rales", "Lung rales", "Symptoms & Exam"),
    _yn("sys_murmur", "Systolic Murmur", "Systolic murmur", "Symptoms & Exam"),
    _yn("dia_murmur", "Diastolic Murmur", "Diastolic murmur", "Symptoms & Exam"),
    _yn("typical_cp", "Typical Chest Pain", "Typical chest pain", "Symptoms & Exam",
        "Classic angina: substernal, exertional, relieved by rest/nitrates."),
    _yn("dyspnea", "Dyspnea", "Dyspnea", "Symptoms & Exam"),
    Feature("function_class", "Function Class", "Functional class", "Symptoms & Exam", "ordinal",
            options=[[0, "0 - none"], [1, "I"], [2, "II"], [3, "III"]], minimum=0, maximum=3, step=1),
    _yn("atypical", "Atypical", "Atypical chest pain", "Symptoms & Exam"),
    _yn("nonanginal", "Nonanginal", "Non-anginal chest pain", "Symptoms & Exam"),
    _yn("lowth_ang", "LowTH Ang", "Low-threshold angina", "Symptoms & Exam"),
    # ---------------- ECG
    _yn("q_wave", "Q Wave", "Pathological Q wave", "ECG"),
    _yn("st_elevation", "St Elevation", "ST elevation", "ECG"),
    _yn("st_depression", "St Depression", "ST depression", "ECG"),
    _yn("t_inversion", "Tinversion", "T-wave inversion", "ECG"),
    _yn("lvh", "LVH", "Left ventricular hypertrophy", "ECG"),
    _yn("poor_r", "Poor R Progression", "Poor R-wave progression", "ECG"),
    Feature("bbb", "BBB", "Bundle branch block", "ECG", "categorical",
            options=[["N", "None"], ["LBBB", "Left BBB"], ["RBBB", "Right BBB"]]),
    # ---------------- Laboratory
    Feature("fbs", "FBS", "Fasting blood sugar", "Laboratory", "numeric", "mg/dL", (70, 100), 50, 400, 1, modifiable=True),
    Feature("cr", "CR", "Creatinine", "Laboratory", "numeric", "mg/dL", (0.6, 1.2), 0.4, 6, 0.1),
    Feature("tg", "TG", "Triglycerides", "Laboratory", "numeric", "mg/dL", (0, 150), 30, 1100, 1, modifiable=True),
    Feature("ldl", "LDL", "LDL cholesterol", "Laboratory", "numeric", "mg/dL", (0, 100), 15, 250, 1, modifiable=True),
    Feature("hdl", "HDL", "HDL cholesterol", "Laboratory", "numeric", "mg/dL", (40, 90), 15, 120, 1, modifiable=True),
    Feature("bun", "BUN", "Blood urea nitrogen", "Laboratory", "numeric", "mg/dL", (7, 20), 4, 60, 1),
    Feature("esr", "ESR", "Erythrocyte sedimentation rate", "Laboratory", "numeric", "mm/h", (0, 20), 1, 100, 1),
    Feature("hb", "HB", "Hemoglobin", "Laboratory", "numeric", "g/dL", (12, 17.5), 8, 18, 0.1),
    Feature("k", "K", "Potassium", "Laboratory", "numeric", "mEq/L", (3.5, 5.0), 3, 6.5, 0.1),
    Feature("na", "Na", "Sodium", "Laboratory", "numeric", "mEq/L", (135, 145), 125, 160, 1),
    Feature("wbc", "WBC", "White blood cells", "Laboratory", "numeric", "/mm³", (4000, 11000), 3000, 20000, 100),
    Feature("lymph", "Lymph", "Lymphocytes", "Laboratory", "numeric", "%", (20, 40), 5, 70, 1),
    Feature("neut", "Neut", "Neutrophils", "Laboratory", "numeric", "%", (40, 70), 30, 90, 1),
    Feature("plt", "PLT", "Platelets", "Laboratory", "numeric", "×10³/µL", (150, 450), 25, 750, 1),
    # ---------------- Echocardiography
    Feature("ef", "EF-TTE", "Ejection fraction (TTE)", "Echocardiography", "numeric", "%", (55, 70), 15, 60, 5),
    Feature("rwma", "Region RWMA", "Regions with wall-motion abnormality", "Echocardiography", "ordinal",
            options=[[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]], minimum=0, maximum=4, step=1,
            description="Number of myocardial regions with abnormal wall motion. An input finding -- not a lesion map."),
    Feature("vhd", "VHD", "Valvular heart disease", "Echocardiography", "ordinal",
            options=[[0, "None"], [1, "Mild"], [2, "Moderate"], [3, "Severe"]], minimum=0, maximum=3, step=1),
]

# Columns present in the raw data that carry no information (constant) and are dropped.
DROPPED_CONSTANT = ["Exertional CP"]

FEATURE_KEYS = [f.key for f in FEATURES]
FEATURE_BY_KEY = {f.key: f for f in FEATURES}

_YN = {"Y": 1, "N": 0, "y": 1, "n": 0}
_VHD = {"N": 0, "mild": 1, "Mild": 1, "Moderate": 2, "moderate": 2, "Severe": 3, "severe": 3}


def load_raw(path) -> pd.DataFrame:
    df = pd.read_excel(path)
    df.columns = [c.strip() for c in df.columns]
    return df


def encode_inputs(raw: pd.DataFrame) -> pd.DataFrame:
    """Raw dataset rows -> tidy model-input frame keyed by Feature.key.

    Only deterministic, row-wise transformations happen here (no statistics are
    learned), so this step cannot leak information across CV folds. Any learned
    transformation (scaling, one-hot categories) lives inside the sklearn Pipeline.
    """
    out = {}
    for f in FEATURES:
        col = raw[f.column]
        if f.key == "sex_male":
            out[f.key] = col.astype(str).str.strip().str.lower().map(lambda s: 1 if s.startswith("m") else 0)
        elif f.key == "vhd":
            out[f.key] = col.astype(str).str.strip().map(_VHD)
        elif f.kind == "binary":
            out[f.key] = col.map(lambda v: _YN.get(str(v).strip(), v)).astype(int)
        elif f.kind == "categorical":
            out[f.key] = col.astype(str).str.strip()
        else:
            out[f.key] = pd.to_numeric(col)
    X = pd.DataFrame(out)
    assert not set(X.columns) & set(LEAKAGE_COLUMNS)
    return X


def encode_targets(raw: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({t: (raw[c].astype(str).str.strip() == pos).astype(int)
                         for t, (c, pos, _) in TARGETS.items()})


def records_to_frame(records: list[dict]) -> pd.DataFrame:
    """API payloads (dicts keyed by Feature.key) -> model-input frame."""
    rows = []
    for r in records:
        row = {}
        for f in FEATURES:
            v = r.get(f.key)
            if v is None:
                raise ValueError(f"missing feature '{f.key}'")
            row[f.key] = str(v) if f.kind == "categorical" else float(v)
        rows.append(row)
    return pd.DataFrame(rows, columns=FEATURE_KEYS)


def schema_json() -> list[dict]:
    return [asdict(f) for f in FEATURES]
