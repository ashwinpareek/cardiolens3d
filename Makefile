# CardioLens 3D: one command per step. `make reproduce` retrains everything and checks the reported numbers.
PY ?= python
export PYTHONWARNINGS := ignore::FutureWarning,ignore::UserWarning
FE := frontend

.PHONY: help install train external optimism results reproduce check test e2e build single serve clean

help:            ## list targets
	@grep -E "^[a-z]+:.*##" Makefile | sed "s/:.*##/ -/"

install:         ## pinned Python + Node dependencies
	$(PY) -m pip install -r requirements-dev.txt
	cd $(FE) && npm ci

train:           ## nested CV of the full pipeline, fit final model, export bundle + model card (~4 min on 2 cores)
	cd ml && $(PY) train_final.py --repeats 5 --boot 60

external:        ## external validation on the four UCI Heart Disease cohorts (920 patients)
	cd ml && $(PY) external_validation.py

optimism:        ## same pipeline on 100 single random splits (why single-split accuracies look higher)
	cd ml && $(PY) split_optimism.py --splits 100

results: external optimism  ## attach both to the model card and app data
	$(PY) ml/attach_results.py

reproduce: train results check test  ## retrain from scratch and confirm every reported metric

check:           ## compare metrics with ml/results/expected_metrics.json (tolerance 0.005)
	$(PY) ml/check_reproduction.py

test:            ## leakage, engine parity (Python = sklearn = browser to 1e-9), API contract
	$(PY) -m pytest -q tests

e2e: single build ## browser test of the whole journey: expert, note import, PDFs, guided steps, no-WebGL, server parity
	$(PY) tests/e2e/smoke.py

build:           ## production web build (served by the FastAPI backend)
	cd $(FE) && npm run build

single:          ## one self-contained offline HTML file: CardioLens3D.html
	cd $(FE) && VITE_STATIC_DEMO=1 npx vite build --outDir ../build/static --emptyOutDir
	$(PY) $(FE)/scripts/make_single_html.py build/static $(FE)/public/anatomy/heart_scene.glb CardioLens3D.html

serve: build     ## API + app on http://localhost:8000
	$(PY) -m uvicorn backend.app.main:app --port 8000

clean:
	rm -rf build $(FE)/dist CardioLens3D.html
