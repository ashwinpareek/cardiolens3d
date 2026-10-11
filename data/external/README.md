# External validation cohorts

`uci_heart_disease_920.csv`: the four original UCI Heart Disease cohorts combined (920 patients:
Cleveland 304, Hungary 293, Switzerland 123, VA Long Beach 200), one row per patient, with a `dataset`
column naming the cohort. Same label definition as Z-Alizadeh Sani: `num > 0` means at least one major
vessel with ≥50% diameter narrowing on angiography.

Source: Janosi, A., Steinbrunn, W., Pfisterer, M. & Detrano, R. (1989). *Heart Disease*. UCI Machine
Learning Repository. https://doi.org/10.24432/C52P4X (CC BY 4.0). This combined CSV is the widely used
Kaggle export ("Heart Disease Data", redwankarimsony); it was copied unchanged from
https://github.com/Vasusagar05/Heart-Disease-Prediction (data/heart.csv).

SHA-256: see ml/results/external_validation.json (`source_sha256`).

Used only for testing (`ml/external_validation.py`). Never used for training or model selection.
