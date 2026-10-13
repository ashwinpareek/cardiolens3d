---
title: CardioLens 3D
emoji: 🫀
colorFrom: red
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
---

# CardioLens 3D

**Coronary artery disease risk, mapped onto a real 3D heart, with the reasons behind every number.**

**Live demo: [cardiolens3d.vercel.app](https://cardiolens3d.vercel.app)** · runs entirely in your browser, no install, no GPU needed

CardioLens takes 54 routine clinical inputs (demographics, history, examination, ECG, labs, echo) and predicts:

- overall coronary artery disease (CAD)
- significant (≥50%) stenosis of the **LAD**, **LCX** and **RCA**

It then paints those predictions onto an anatomically accurate, interactive heart and torso in the browser. Every estimate comes with:

- an exact explanation
- a calibrated uncertainty interval
- a conformal "I'm not sure" signal
- the most similar real patients and what angiography actually showed for them

Built for **Multimodal AI Hackathon 2026 (IIT Mandi), Track A: Cardiovascular Risk Visualization & Prediction.**

> ⚠️ **Decision support and education only.** Not a diagnosis, and not a substitute for coronary angiography, CT coronary angiography or a clinician's judgement.

![CardioLens 3D](docs/img/app_main.png)

---

## Two ways to use it

The app **opens on the expert view** so the 3D heart is the first thing you see: it turns slowly until you touch it, coloured by a real dataset patient (#35) whose angiogram showed a narrowed LAD and RCA and a clear LCX. A highlighted **Guided view** button sits next to the logo. Add `#guide` to the URL to open straight in the guided view.

**Guided view** is for anyone, including people with no medical background. It walks through five steps:

1. **Patient:** pick one of seven example patients, four of them real dataset cases with their angiography result, or answer a short quick-check form. All 54 fields are one click away.
2. **Heart:** the 3D heart has a narrated **guided tour** ("Explain this heart"). You can **cut it open** to see the chambers, **lift the arteries** off the surface (exploded view), switch to an **X-ray / angiogram look**, or see where the heart sits **in the body**. A live **ECG strip** is drawn from the patient's ECG findings and pulse, and you can tap an artery to fly to it.
3. **Why:** a SHAP **force plot**, cards showing what raises and what lowers the risk (as odds multipliers), a breakdown of which part of the check-up matters most, a **feature × target heatmap**, measurement tiles against normal ranges, and the 12 most similar real patients with their outcomes.
4. **What if:** move blood pressure, cholesterol, sugar, weight or smoking and watch the heart and the before/after bars update. One-tap scenarios are included.
5. **Report:** download a **2-page PDF** with the 3D snapshot, estimates, reasons, body-system chart, measurement table and model validation. The same data is also available as CSV or JSON.

Underlined terms (LAD, EF, RWMA, stenosis, conformal set and others) show plain-English definitions on hover or tap.

**Expert view** (default) keeps everything on one screen for clinicians and judges: all inputs, the 3D viewer (with X-ray, lift-arteries, cut-open and spin controls), the AHA bullseye, waterfall explanations, measurements, similar patients and the full model-evidence tab.

## What makes it different

| | |
|---|---|
| **Real anatomy, real vessels** | The heart, the coronary tree (LAD with diagonals and septals, LCX, RCA with marginal, PDA and posterolateral branches), the great vessels, lungs, ribs and body surface all come from **BodyParts3D**. Each coronary branch is its own named mesh, bound to its model output through a config registry. |
| **Interactive anatomy** | A guided camera tour narrated from the patient's own prediction, a cross-section cut, an exploded "lift arteries" view, an angiogram (X-ray) look, focus mode for the selected artery, clickable artery hotspots, and a synthetic ECG whose waveform follows the ECG inputs (Q waves, ST changes, T inversion, LVH, bundle branch block) at the patient's pulse rate. |
| **Spatial risk mapping** | Vessels are coloured by calibrated probability. The myocardium is tinted by **perfusion territory**, using per-vertex soft assignment to the nearest coronary tree. An **AHA 17-segment bullseye** mirrors it in 2D. **Flow particles** run along centrelines extracted from the vessel meshes, and the heart **beats at the patient's pulse-rate input**. |
| **Anatomically consistent model** | P(vessel) = P(CAD) × P(vessel \| CAD). On identical folds this matches the discrimination of direct vessel models and improves calibration for all three vessels. It also removes the **704** out-of-fold cases where direct models rated a vessel as more likely stenotic than CAD itself. A red artery can never appear on a "no CAD" heart. |
| **Validation of the whole pipeline** | Repeated (5×5) outer CV, with algorithm choice, hyper-parameters, Platt calibration, Youden thresholds and conformal quantiles all fit **inside** each training fold. 9 algorithms were compared with nested CV. Sanity checks include a label-permutation test (AUC 0.49) and a leakage demonstration (AUC 0.997 if the vessel columns were used as inputs). |
| **Exact explanations** | The models are additive (logistic), so per-feature contributions are **exact interventional SHAP** (they match `shap.LinearExplainer` to 4e-16). Hierarchical vessels use closed-form integrated gradients that sum exactly to the patient's log-odds. These are not sampled approximations. |
| **Honest uncertainty** | A bootstrap 90% interval on every probability, plus **Mondrian conformal prediction sets** at 90%. Empirical coverage is 88–90%, so the UI says "uncertain" when the model can't decide. |
| **Externally validated** | A reduced CAD model on the inputs both datasets share was tested, unchanged, on **920 patients from four other hospitals** (UCI Cleveland, Hungary, Switzerland, VA): AUC **0.756** (0.725–0.787) with near-ideal pooled calibration. See [Results](#external-validation). |
| **Clinical-note import** | A second input modality: paste or open a referral letter or lab report, and transparent in-browser rules extract the inputs (with negations such as "no Q waves" and mmol/L → mg/dL conversion), showing the source words for every value before loading. |
| **Runs anywhere** | FastAPI model server, plus an identical in-browser engine (tested to 1e-9 on all 303 patients). No GPU is needed: **adaptive quality** lowers resolution, then switches to a 12k-triangle heart and pauses the heartbeat when the frame rate drops. The whole app also ships as one offline HTML file. |
| **Extensible by config** | `ml/features.py` (inputs), `config/registry.json` (targets → meshes → AHA segments), `anatomy/anatomy_registry.json` (meshes). Adding a lab value, a target or a structure doesn't need a redesign. |

## Results

Mean ± SD over 25 outer folds (5-fold × 5 repeats) of the **complete** pipeline. The operating threshold is chosen inside each fold (Youden J); n = 303.

| Target | Model | ROC-AUC | PR-AUC | Accuracy | Precision | Recall | Specificity | F1 | Brier | Conformal coverage (90%) |
|---|---|---|---|---|---|---|---|---|---|---|
| CAD | Logistic (L2) | **0.928 ± 0.029** | 0.970 | 0.845 | 0.947 | 0.830 | 0.883 | 0.883 | 0.098 | 90.0% |
| LAD | P(CAD) × logistic (L1) | **0.849 ± 0.040** | 0.882 | 0.771 | 0.799 | 0.816 | 0.712 | 0.803 | 0.155 | 89.4% |
| LCX | P(CAD) × logistic (L1) | **0.706 ± 0.054** | 0.578 | 0.643 | 0.532 | 0.810 | 0.537 | 0.638 | 0.207 | 88.3% |
| RCA | P(CAD) × logistic (L1) | **0.738 ± 0.050** | 0.604 | 0.642 | 0.517 | 0.830 | 0.532 | 0.633 | 0.198 | 89.2% |

Pooled out-of-fold ROC-AUC 95% bootstrap CIs:

- CAD: 0.899–0.956
- LAD: 0.792–0.884
- LCX: 0.633–0.751
- RCA: 0.673–0.792

The full model card (ROC, calibration, decision curves, subgroups, algorithm comparison) is in [`ml/artifacts/model_card.json`](ml/artifacts/model_card.json) and in the app's **Model evidence** tab.

On 303 patients, gradient boosting, random forests, SVMs and EBMs landed within about ±0.01 AUC of regularised logistic regression on CAD, LAD and RCA. LightGBM's LCX AUC of 0.730 versus our 0.706 is well inside the fold-to-fold SD (±0.054): noise, not a reason to give up exact explanations that run identically in the browser.

### External validation

Overall CAD only (the UCI cohorts have no per-artery labels). Reduced model on 10 shared inputs: age, sex, chest-pain type, resting BP, fasting sugar > 120 mg/dL, resting ECG ST-T change, LVH, total cholesterol (Z-Alizadeh Sani: LDL + HDL + TG/5). Cleveland's `ca` is excluded because it is effectively part of the answer. Trained on all 303 Z-Alizadeh Sani patients, never refit. Script: [`ml/external_validation.py`](ml/external_validation.py); data provenance: [`data/external/README.md`](data/external/README.md).

| Test cohort | n | CAD prevalence | ROC-AUC (95% CI) |
|---|---|---|---|
| Cleveland | 304 | 46% | 0.764 (0.71–0.82) |
| Hungary | 293 | 36% | 0.767 (0.71–0.82) |
| Switzerland | 123 | 93% | 0.702 (0.47–0.91) |
| VA Long Beach | 200 | 75% | 0.636 (0.55–0.72) |
| **All four** | **920** | 55% | **0.756 (0.725–0.787)** |

> **Scope:** this is a separate reduced model for overall CAD only, not the deployed 54-input four-target model. The LAD, LCX and RCA predictions have no external validation.

Internal nested-CV AUC of the same reduced model: 0.903 ± 0.043. The same inputs trained *inside* UCI reach 0.839, an upper bound for transfer. Pooled calibration intercept 0.03, slope 1.00; but the threshold chosen at the training hospital (0.70) is too strict elsewhere: sensitivity 39%, specificity 88% (at 0.5: 78% / 63%). Ranking transfers; the cut-off does not, so a new hospital must set its own threshold.

### Why our accuracy is 84.5%, not 95%

[`ml/split_optimism.py`](ml/split_optimism.py) runs the exact same pipeline on 100 single random 80/20 splits:

| Same pipeline, same data | CAD accuracy |
|---|---|
| **Nested, repeated CV (reported)** | **84.5%** |
| One random split, median | 85.2% |
| One random split, 5th–95th percentile | 78.7–91.8% |
| One random split, luckiest of 100 | 95.1% |
| Threshold tuned on the test set (leaky) | 96.7% |

With 61 test patients, a single split swings by about ±7 points. A lucky split, or a threshold tuned on the test patients, explains most 95%+ figures reported for this dataset.

## Quick start

### Option A: Docker (one command)

```bash
docker compose up --build
# open http://localhost:8000
```

### Option B: local development

Prerequisites: Python 3.11+ (tested on 3.13) and Node 18+ (tested on 22).

```bash
pip install -r requirements.txt            # serving + training
cd frontend && npm ci && cd ..

# terminal 1: model server
uvicorn backend.app.main:app --port 8000

# terminal 2: web app with hot reload (proxies /api to :8000)
cd frontend && npm run dev                  # http://localhost:5173
```

### Option C: static, no server

```bash
cd frontend && npm run build && npx serve dist   # or any static host (GitHub Pages, Netlify, Vercel)
```

Without a reachable `/api`, the app switches to the in-browser engine. The header shows **Model: in-browser**, and the numbers are identical.
For hosts that only serve standard web types, build with `VITE_STATIC_DEMO=1 npm run build`: it loads the anatomy from `heart_scene.json` (the same model as embedded glTF, made by `anatomy/glb_to_gltf_json.py`) and hides the print button.

## Reproduce everything

All randomness is seeded (`SEED = 42`) and dependencies are pinned. The trained weights are committed; one command regenerates them and checks every reported number:

```bash
make install     # pinned Python + Node dependencies
make reproduce   # retrain → external validation → split study → compare 20 metrics with ml/results/expected_metrics.json → tests
make single      # CardioLens3D.html: the whole app in one offline file
```

`make e2e` drives the whole app in a real browser (19 checks): both views, clinical-note import, both PDF exports against the on-screen numbers, a browser with WebGL disabled (falls back to a 2D artery diagram), and the FastAPI server versus the in-browser engine, including fallback when the server stops.

`make reproduce` takes about 5 minutes on 2 CPU cores and regenerates a byte-identical model bundle. `make test` includes tests that fail if `LAD`, `LCX`, `RCA` or `Cath` ever reach the model's inputs, its exported weights or the app's input schema.

The supporting experiments, individually:

```bash
cd ml
python compare_models.py --repeats 5        # 9 algorithms × 4 targets, nested CV   -> results/compare_*.json   (~1 h on 2 cores)
python structure_ablation.py 5              # direct vs hierarchical, paired        -> results/structure_ablation.json
python verify_shap.py                       # attributions vs the shap library      -> results/shap_check.json
python train_final.py --repeats 5 --boot 60 # evaluate full pipeline, fit, export   -> artifacts/ + frontend/public/data/app_data.json
cd ..
python -m pytest -q tests                   # parity (sklearn = Python engine = browser engine), invariants, API contract
```

Anatomy (only needed to rebuild the 3D scene):

```bash
git clone --depth 1 https://github.com/Kevin-Mattheus-Moerman/BodyParts3D   # mirror of BodyParts3D 4.0 STL files
python anatomy/build_anatomy.py --stl BodyParts3D/assets/BodyParts3D_data/stl
npx @gltf-transform/cli meshopt frontend/public/anatomy/heart_scene.glb frontend/public/anatomy/heart_scene.glb   # includes the low-poly LOD (anatomy/add_lod.py)
```

## How it works

```
 Z-Alizadeh Sani extension (303 × 59)
        │  ml/features.py      feature registry: 54 inputs, units, reference ranges; LAD/LCX/RCA/Cath excluded (asserted)
        ▼
 ml/cardio_model.py   CardioModel = per-target additive scorer (L1/L2 logistic, chosen in inner CV)
        │             + Platt calibration + Youden threshold + Mondrian conformal + bootstrap (60)
        │             CAD direct; vessels hierarchical: P(v) = P(CAD)·P(v | CAD)
        ▼
 ml/train_final.py    5×5 outer CV of the whole pipeline → model card; final fit → model_bundle.json (portable weights)
        │
        ├──► backend/app/main.py   FastAPI: /api/predict, /api/whatif, /api/meta … (ml/engine.py over the bundle)
        └──► frontend/src/lib/engine.ts   same arithmetic in the browser (fallback / offline)
                     │
 anatomy/build_anatomy.py  BodyParts3D STL → cleaned, decimated, re-oriented GLB (named meshes, territory weights in COLOR_0)
                     │                       + vessel centrelines (voxelise → skeletonise → graph paths)
                     ▼
 frontend (React + React Three Fiber)  3D viewer · assessment rail · explanations · evidence · what-if · report
```

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, model timestamp |
| GET | `/api/meta` | feature schema, target registry, model card, presets |
| GET | `/api/patients/{id}` | a dataset patient with angiography labels and out-of-fold scores |
| POST | `/api/predict` | `{"inputs": {...}}` → probabilities, intervals, conformal sets, attributions. Missing inputs are filled with the median patient and listed in `warnings`. Add `?check=true` to also score through the original sklearn pipelines. |
| POST | `/api/predict/batch` | up to 1000 patients |
| POST | `/api/whatif` | `{"inputs": {...}, "changes": {...}}` → before / after / delta |

Interactive docs are at `http://localhost:8000/docs`.

### Extending

- **New clinical feature:** add a `Feature(...)` to `ml/features.py` and re-run `train_final.py`. The form, API validation, explanations and measurements table pick it up automatically.
- **New target or vessel:** add it to `TARGETS` in `ml/features.py` and to `config/registry.json`, then tag its meshes with `"target": "<id>"` in `anatomy/anatomy_registry.json`.
- **New anatomical structure:** add an entry with its FMA id(s) to `anatomy/anatomy_registry.json` and re-run `build_anatomy.py`.

## Repository layout

```
ml/            features.py · models.py · cardio_model.py · engine.py · compare_models.py · structure_ablation.py
               verify_shap.py · train_final.py · external_validation.py · split_optimism.py · check_reproduction.py · artifacts/ (weights, bundle, model card) · results/ (experiments)
backend/app/   FastAPI server
frontend/      React + TypeScript + React Three Fiber app (src/three = 3D scene, src/components = dashboard)
anatomy/       BodyParts3D → GLB pipeline and anatomy registry
config/        target ↔ mesh ↔ AHA-segment registry
tests/         no-leakage, parity, invariants, API contract (23 tests)
docs/          project documentation (PDF), demo video script, screenshots
data/          the dataset (CC BY 4.0); external/ the UCI Heart Disease test cohorts (CC BY 4.0)
```

## Limitations

- Trained on 303 patients from a single Iranian centre. Overall CAD transfers to four external hospitals with lower discrimination (AUC 0.76) and needs local threshold recalibration; per-vessel predictions are validated internally only.
- Labels are vessel-level. The dataset does not record **where** along a vessel a lesion sits, so the whole vessel is coloured and the UI says so.
- Territory tinting uses nearest-vessel assignment on a reference heart. Real perfusion territories vary between patients (for example, right- vs left-dominant circulation).
- Vessel-level discrimination is lower in patients ≥ 60 and in diabetics (see subgroups in the model card).
- Some associations reflect treatment rather than biology. For example, lower LDL is linked to higher risk, plausibly because patients with known disease are already on statins. The "Modifiable factors" panel never offers such a change as advice: it is collapsed under a labelled "dataset artifact" note.

## Credits and licences

- **Dataset:** Alizadehsani R., Roshanzamir M., Sani Z. (2013). *Extention of Z-Alizadeh Sani dataset.* UCI Machine Learning Repository. [doi:10.24432/C5461K](https://doi.org/10.24432/C5461K). CC BY 4.0.
- **External validation data:** Janosi A., Steinbrunn W., Pfisterer M., Detrano R. (1989). *Heart Disease.* UCI Machine Learning Repository. [doi:10.24432/C52P4X](https://doi.org/10.24432/C52P4X). CC BY 4.0.
- **Anatomy:** BodyParts3D, © 2008 Life Science Integrated Database Center, licensed under CC BY-SA 2.1 Japan. The derived GLB (`frontend/public/anatomy/`) is shared under the same licence.
- **AHA 17-segment model:** Cerqueira M.D. et al., *Circulation* 2002;105:539–542.
- **Code:** MIT licence (see `LICENSE`).
