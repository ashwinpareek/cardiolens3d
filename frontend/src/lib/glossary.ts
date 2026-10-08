/** Plain-language definitions shown on hover/focus wherever a technical term appears. */
export const GLOSSARY: Record<string, string> = {
  CAD: 'Coronary artery disease: plaque narrowing the arteries that feed the heart muscle. Here it means at least one major artery narrowed by 50% or more on angiography.',
  LAD: 'Left anterior descending artery. Runs down the front of the heart and feeds the front wall and most of the septum. Often called the "widow-maker" when blocked near its start.',
  LCX: 'Left circumflex artery. Wraps around the left side of the heart in the groove between the left atrium and ventricle, feeding the side and back wall.',
  RCA: 'Right coronary artery. Runs around the right side of the heart and usually feeds the right ventricle and the bottom (inferior) wall.',
  stenosis: 'Narrowing of an artery. 50% or more is considered significant in this dataset.',
  angiography: 'An X-ray test where dye is injected into the coronary arteries to show narrowings directly. It is the reference test this model tries to anticipate.',
  EF: 'Ejection fraction: the share of blood the left ventricle pumps out with each beat. About 55–70% is normal; lower values suggest weakened muscle.',
  RWMA: 'Regional wall-motion abnormality: parts of the heart wall that move poorly on echocardiography, often a sign of reduced blood supply or an old heart attack.',
  'typical angina': 'Chest pressure that comes on with exertion and settles with rest or nitroglycerin: the classic symptom of narrowed coronary arteries.',
  ECG: 'Electrocardiogram: a recording of the heart\'s electrical activity. Q waves, ST changes and T-wave inversion can point to reduced blood supply.',
  'conformal set': 'A statistical safety net: the set of outcomes the model cannot rule out at 90% confidence. If both "yes" and "no" remain, the model is honestly uncertain.',
  SHAP: 'A way to split a prediction into contributions from each input, so you can see which factors pushed the risk up or down and by how much.',
  territory: 'The area of heart muscle that a particular artery supplies with blood.',
  'log-odds': 'The scale the model adds contributions on. +0.7 roughly doubles the odds, −0.7 roughly halves them.',
}
