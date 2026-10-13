# CardioLens 3D: demo video script (final, 3:37)

Recorded from the real app with scripted, frame-by-frame capture; narration is a synthetic voice (Kokoro TTS) and the music bed is original. English captions are burned in and also provided as an .srt file for YouTube.

| Time | Chapter | Narration |
|---|---|---|
| 0:00 | Hook | Risk scores are just numbers. But cardiologists don't think in numbers. They think in arteries. |
| 0:07 | Title | CardioLens 3D predicts coronary artery disease, and which of the three main heart arteries is likely narrowed, from routine check-up data. Then it shows the answer on a real 3D heart. |
| 0:20 | 01 See: Risk, artery by artery | This is a real patient from the dataset, with their angiogram on record. The left anterior descending artery is red, at 93%. The right coronary is amber, at 54%. The circumflex is green, at 37%. The angiogram agreed: LAD and right coronary narrowed, circumflex clear. |
| 0:42 | 01 See: Real anatomy you can explore | Every artery is a real anatomical mesh from BodyParts3D, coloured by its own prediction. Lift the arteries off the surface. Switch to an angiogram-style X-ray. Cut the heart open, or see where it sits in the chest. |
| 0:58 | 02 Explain: Every number explains itself | Every estimate explains itself. These are exact SHAP contributions: red pushes the risk up, teal pulls it down. Pick any artery, and the explanation follows. Every measurement sits next to its normal range, and the bullseye shows which part of the heart muscle each artery feeds. |
| 1:16 | 03 Import: Reads the doctor's letter | Real patients arrive as letters, not forms. Paste a referral letter, and CardioLens reads it right in the browser. It understands negations like “no Q waves”, converts units like mmol/L, and shows exactly which words became which input. One click, and the heart updates. |
| 1:36 | 04 Guide: Plain English for everyone | For anyone without a medical background, a guided view walks through five steps in plain English. The narrated tour is written from this patient's own prediction, artery by artery. |
| 1:48 | 04 Guide: What if things were different? | What if blood pressure were different? Move a slider, and the heart and every estimate update instantly. It's clearly labelled as model behaviour, not a treatment effect. |
| 1:59 | 05 Report: A report in one click | One click gives a 2-page PDF report: the 3D snapshot, the estimates, the reasons, and how the model was validated. |
| 2:08 | 06 Validate: Honest validation | Under the hood, the whole pipeline is validated with repeated, nested cross-validation. The CAD model reaches an AUC of 0.93. Each artery is modelled as the chance of disease, times the chance of that artery given disease, so an artery can never look riskier than the disease itself. That removed 704 contradictions. And 90% conformal prediction sets flag when the model is honestly unsure. |
| 2:38 | 06 Validate: Tested on 920 new patients | We then tested it on 920 patients from four other hospitals it had never seen. The AUC was 0.76, with near-perfect average calibration. That's a reduced, CAD-only model, and the panel says so plainly. And why is our accuracy 84.5%, not 95%? The same pipeline, on one lucky split, scores 95%. We report the honest number. |
| 3:06 | 07 Robust: Runs anywhere, reproducible | It runs in any browser, with no GPU. If 3D isn't available, a 2D diagram takes over and everything else keeps working. One command retrains everything and confirms every reported metric, and 19 browser tests check the whole journey. |
| 3:23 | End card | CardioLens 3D. Decision support and education, not a diagnosis. Try it live at cardiolens3d.vercel.app. |
