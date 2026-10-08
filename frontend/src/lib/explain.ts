import type { Attribution, FeatureSpec, Prediction, TargetId } from './types'

export const GROUP_META: Record<string, { label: string; icon: string; blurb: string }> = {
  'Symptoms & Exam': { label: 'Symptoms & exam', icon: 'M6 3v5a4 4 0 0 0 8 0V3M10 12v3a5 5 0 0 0 10 0v-3M20 9a2 2 0 1 0 0 .1', blurb: 'chest pain type, breathlessness, vital signs' },
  ECG: { label: 'ECG', icon: 'M2 12h4l2-6 3 12 3-9 2 3h6', blurb: 'electrical signs of reduced blood supply' },
  Echocardiography: { label: 'Heart ultrasound', icon: 'M12 3a9 9 0 1 0 0 18M12 7a5 5 0 1 0 0 10', blurb: 'pumping strength and wall motion' },
  Laboratory: { label: 'Blood tests', icon: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M8 3h8', blurb: 'sugar, lipids, kidney and blood counts' },
  History: { label: 'Medical history', icon: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h4', blurb: 'diabetes, blood pressure, smoking, family' },
  Demographics: { label: 'Age, sex & build', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', blurb: 'age, sex, weight, BMI' },
}

export function groupContributions(att: Attribution, features: FeatureSpec[]) {
  const by: Record<string, { net: number; abs: number; top: { key: string; c: number }[] }> = {}
  for (const f of features) {
    const c = att.contributions[f.key] ?? 0
    const g = (by[f.group] ??= { net: 0, abs: 0, top: [] })
    g.net += c
    g.abs += Math.abs(c)
    g.top.push({ key: f.key, c })
  }
  for (const g of Object.values(by)) g.top.sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
  const total = Object.values(by).reduce((s, g) => s + g.abs, 0) || 1
  return Object.entries(by)
    .map(([group, g]) => ({ group, ...g, share: g.abs / total }))
    .sort((a, b) => b.abs - a.abs)
}

/** features ranked by their largest absolute contribution across all four targets */
export function heatmapRows(pred: Prediction, n = 12) {
  const keys = Object.keys(pred.attributions.CAD.contributions)
  const targets: TargetId[] = ['CAD', 'LAD', 'LCX', 'RCA']
  return keys
    .map((k) => ({ key: k, vals: targets.map((t) => pred.attributions[t].contributions[k] ?? 0) }))
    .sort((a, b) => Math.max(...b.vals.map(Math.abs)) - Math.max(...a.vals.map(Math.abs)))
    .slice(0, n)
}

export const sig = (z: number) => 1 / (1 + Math.exp(-z))

import type { DatasetPatient, FeatureSpec as FS, Inputs } from './types'

/** nearest dataset patients: standardised distance weighted by global CAD importance */
export function findSimilar(patients: DatasetPatient[], features: FS[], weights: Record<string, number>, inputs: Inputs, k = 12) {
  const num = features.filter((f) => f.kind !== 'categorical')
  const st = Object.fromEntries(num.map((f) => {
    const xs = patients.map((p) => Number(p.inputs[f.key])); const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return [f.key, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1]
  }))
  return patients
    .map((p) => ({ p, d: num.reduce((s, f) => s + (weights[f.key] ?? 0.05) * ((Number(p.inputs[f.key]) - Number(inputs[f.key])) / st[f.key]) ** 2, 0) + (p.inputs.bbb !== inputs.bbb ? (weights.bbb ?? 0.05) : 0) }))
    .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.p)
}
