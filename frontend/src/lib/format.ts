import type { Attribution, FeatureSpec, Inputs } from './types'
import { pct } from './risk'

export function valueText(f: FeatureSpec, v: number | string): string {
  if (f.kind === 'binary') {
    if (f.key === 'sex_male') return Number(v) ? 'male' : 'female'
    return Number(v) ? 'yes' : 'no'
  }
  if (f.options) {
    const o = f.options.find(([x]) => String(x) === String(v))
    if (o) return o[1]
  }
  const n = Number(v)
  const s = f.step && f.step < 1 ? n.toFixed(1) : String(Math.round(n))
  return f.unit ? `${s} ${f.unit}` : s
}

/** lower-case a label for use mid-sentence, keeping acronyms (ST, LDL, HDL, BMI) intact */
export function lower(s: string) {
  return s.split(' ').map((w) => ((w.length > 1 && w === w.toUpperCase()) || /^[A-Z](-|$)/.test(w) ? w : w.toLowerCase())).join(' ')
}

/** phrase used in the plain-language explanation */
export function phrase(f: FeatureSpec, v: number | string): string {
  if (f.kind === 'binary') {
    if (f.key === 'sex_male') return Number(v) ? 'male sex' : 'female sex'
    return Number(v) ? lower(f.label) : `no ${lower(f.label)}`
  }
  if (f.key === 'rwma') return Number(v) ? `wall-motion abnormality in ${v} region${Number(v) > 1 ? 's' : ''}` : 'no regional wall-motion abnormality'
  if (f.key === 'bbb') return v === 'N' ? 'no bundle branch block' : `${v}`
  if (f.key === 'vhd') return Number(v) ? `${valueText(f, v).toLowerCase()} valvular disease` : 'no valvular disease'
  if (f.key === 'function_class') return Number(v) ? `functional class ${valueText(f, v)}` : 'no functional limitation'
  if (f.key === 'age') return `age ${v}`
  return lower(`${f.label.replace(/\s*\(.*\)/, '')} ${valueText(f, v)}`)
}

export interface Ranked { key: string; c: number; f: FeatureSpec }

export function rank(att: Attribution, feats: Record<string, FeatureSpec>): Ranked[] {
  return Object.entries(att.contributions)
    .map(([key, c]) => ({ key, c, f: feats[key] }))
    .filter((r) => r.f)
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
}

function list(xs: string[]) {
  if (xs.length <= 1) return xs.join('')
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
}

export function narrative(target: string, p: number, att: Attribution, feats: Record<string, FeatureSpec>, inputs: Inputs) {
  const r = rank(att, feats)
  const up = r.filter((x) => x.c > 0.05).slice(0, 3).map((x) => phrase(x.f, inputs[x.key]))
  const down = r.filter((x) => x.c < -0.05).slice(0, 2).map((x) => phrase(x.f, inputs[x.key]))
  const what = target === 'CAD' ? 'coronary artery disease' : `significant ${target} stenosis`
  let s = `Estimated probability of ${what}: ${pct(p)}.`
  if (up.length) s += ` Raised mostly by ${list(up)}.`
  if (down.length) s += ` ${up.length ? 'Pulled down by' : 'Kept low by'} ${list(down)}.`
  return s
}
