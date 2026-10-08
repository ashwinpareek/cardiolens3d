# CardioLens 3D: demo video script (target 6 min)

The rules ask for 3–10 minutes on YouTube (unlisted is fine), showing the project running and explaining the approach, with English audio or subtitles.
Record at 1920×1080 in Chrome at 100% zoom. Use OBS or the Windows Game Bar (Win+Alt+R). Run the app with `docker compose up` so the header shows **Model: server**.

| Time | Screen | What to say |
|---|---|---|
| 0:00–0:30 | App opens on the **expert view**: the heart turning, LAD red, RCA amber, LCX green. Hover the labels, click **Lift arteries**, then **X-ray**. | "Risk scores are just numbers. Cardiologists think in arteries. This is a real patient from the dataset: CardioLens predicts 93% for the LAD, 54% for the RCA and 37% for the LCX. The angiogram showed the LAD and RCA narrowed and the LCX clear. LAD, LCX, RCA and Cath are never model inputs." |
| 0:30–0:55 | Click the highlighted **Guided view** button. Welcome card, then the **Patient** step: click "Three-vessel disease" and change a few answers. | "Everything here is also available step by step, in plain English, for people with no medical background. Pick an example or answer a few questions. Every answer re-scores instantly." |
| 0:55–2:00 | **Heart** step. Press **Explain this heart** and let the tour run: overview, LAD, LCX, RCA, lifted arteries, cut-away, in the body. | "The guided tour is written from this patient's prediction. Each artery is a real BodyParts3D mesh coloured by its own model output. Here the arteries lift off the surface, here we cut the heart open, and here is where it sits in the chest." |
| 2:00–2:30 | Toggle **X-ray view**, tap RCA, drag the **Cut open** slider. | "An angiogram-style view links the prediction to the test that confirms it. Tapping an artery flies the camera there and explains it in plain words." |
| 2:30–3:30 | **Why** step: the force plot, the raise/lower cards, the check-up breakdown, the heatmap, then switch the tab to LAD. | "Every estimate is broken into exact SHAP contributions. Red pushes the risk up and teal pulls it down, shown as odds multipliers. The heatmap shows how one answer moves all four estimates. And these are the 12 most similar real patients and what their angiograms showed." |
| 3:30–4:10 | **What if** step: lower blood pressure and sugar, tap a one-tap scenario, watch the small heart and the before/after bars. | "Change blood pressure, cholesterol or smoking and the heart recolours live. We label this as model sensitivity, not a treatment effect." |
| 4:10–4:40 | **Report** step: click **Download PDF report** and open the PDF. | "One click gives a two-page PDF with the 3D snapshot, the estimates, the reasons and the validation, or the raw numbers as CSV and JSON." |
| 4:40–5:40 | Back to the **Expert view**, then **Model evidence**: metrics, ROC, calibration, decision curve, algorithm comparison, sanity checks. | "For clinicians and judges, the expert view shows everything at once. The whole pipeline is validated with repeated nested cross-validation, and nine algorithms were compared. Modelling P(vessel) as P(CAD) times P(vessel given CAD) removed 704 contradictions where an artery looked riskier than CAD itself. A label-permutation test gives AUC 0.5." |
| 5:40–6:00 | Disclaimer bar close-up, then the end card. | "CardioLens is decision support and education, not a diagnosis. Thanks for watching." |

Tips: record the voice-over separately and lay it over the screen capture. Add English subtitles in YouTube Studio by pasting the "What to say" column.
