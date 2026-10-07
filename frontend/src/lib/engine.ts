/* In-browser inference engine. Same arithmetic as ml/engine.py (parity-tested on all 303 patients),
 * so the app keeps working, with identical numbers, when no backend is reachable. */
import type { Attribution, Inputs, Prediction, TargetId, TargetPrediction } from './types'

type Term =
  | { key: string; kind: 'lin'; w: number; x0: number }
  | { key: string; kind: 'bins'; cuts: number[]; scores: number[] }
  | { key: string; kind: 'cat'; map: Record<string, number> }
interface Additive { intercept: number; terms: Term[]; means: Record<string, number> }
interface TargetModel {
  structure: 'direct' | 'hierarchical'
  model: Additive
  calib: [number, number]
  threshold: number
  conformal: [number, number]
  boot: Additive[]
}
export interface Bundle { alpha: number; targets: Record<TargetId, TargetModel> }

const N_IG = 48
const sig = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
const logit = (p: number) => { const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9); return Math.log(q / (1 - q)) }

function bisectRight(a: number[], x: number) {
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (x < a[m]) hi = m; else lo = m + 1 }
  return lo
}
function termValue(t: Term, x: number | string): number {
  if (t.kind === 'lin') return t.w * (Number(x) - t.x0)
  if (t.kind === 'bins') return t.scores[bisectRight(t.cuts, Number(x))]
  return t.map[String(x)] ?? 0
}
function additive(m: Additive, x: Inputs) {
  let score = m.intercept, ref = m.intercept
  const contrib: Record<string, number> = {}
  for (const t of m.terms) {
    const v = termValue(t, x[t.key]); const mu = m.means[t.key]
    score += v; ref += mu; contrib[t.key] = v - mu
  }
  return { score, ref, contrib }
}
function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b)
  const pos = q * (s.length - 1), lo = Math.floor(pos), hi = Math.min(lo + 1, s.length - 1)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
function conformalSet(p: number, q: [number, number]): (0 | 1)[] {
  const out: (0 | 1)[] = []
  if (p <= q[0] + 1e-12) out.push(0)
  if (1 - p <= q[1] + 1e-12) out.push(1)
  return out
}

export function predictLocal(bundle: Bundle, x: Inputs): Omit<Prediction, 'engine' | 'ms'> {
  const T = bundle.targets
  const res = {} as Record<TargetId, number>
  const boots = {} as Record<TargetId, number[]>
  const att = {} as Record<TargetId, Attribution>

  const direct = (name: TargetId) => {
    const t = T[name]; const [a, b] = t.calib
    const { score, ref, contrib } = additive(t.model, x)
    const L = a * score + b, L0 = a * ref + b
    const c: Record<string, number> = {}
    for (const k in contrib) c[k] = a * contrib[k]
    att[name] = { base: L0, value: L, contributions: c }
    boots[name] = t.boot.map((m) => sig(a * additive(m, x).score + b))
    res[name] = sig(L)
    return { L, L0, c }
  }

  const cad = direct('CAD')
  for (const v of ['LAD', 'LCX', 'RCA'] as const) {
    const t = T[v]
    if (t.structure === 'direct') { direct(v); continue }
    const [a, b] = t.calib
    const { score, ref, contrib } = additive(t.model, x)
    const Lv = a * score + b, Lv0 = a * ref + b
    const p = res.CAD * sig(Lv)
    res[v] = p
    const bv = t.boot.map((m) => sig(a * additive(m, x).score + b))
    boots[v] = bv.slice(0, Math.min(bv.length, boots.CAD.length)).map((q, i) => q * boots.CAD[i])
    const dL1 = cad.L - cad.L0, dL2 = Lv - Lv0
    let g1 = 0, g2 = 0
    for (let i = 0; i < N_IG; i++) {
      const al = (i + 0.5) / N_IG
      const s1 = sig(cad.L0 + al * dL1), s2 = sig(Lv0 + al * dL2), P = s1 * s2
      g1 += (1 - s1) / (1 - P); g2 += (1 - s2) / (1 - P)
    }
    g1 /= N_IG; g2 /= N_IG
    const base = logit(sig(cad.L0) * sig(Lv0)), val = logit(p)
    const c: Record<string, number> = {}
    let sum = 0, tot = 0
    for (const k in cad.c) { c[k] = cad.c[k] * g1 + a * contrib[k] * g2; sum += c[k]; tot += Math.abs(c[k]) }
    const resid = val - base - sum
    for (const k in c) c[k] += (resid * Math.abs(c[k])) / (tot || 1)
    att[v] = { base, value: val, contributions: c }
  }

  const targets = {} as Record<TargetId, TargetPrediction>
  for (const k of ['CAD', 'LAD', 'LCX', 'RCA'] as TargetId[]) {
    const p = res[k], bs = (boots[k] ?? []).map(logit)
    let lo = p, hi = p
    if (bs.length) { // centred percentile interval: spread of the bootstrap logits around their own mean
      const mu = bs.reduce((s, z) => s + z, 0) / bs.length
      const dev = bs.map((z) => z - mu)
      lo = sig(logit(p) + quantile(dev, 0.05)); hi = sig(logit(p) + quantile(dev, 0.95))
    }
    targets[k] = { p, lo: Math.min(lo, p), hi: Math.max(hi, p), set: conformalSet(p, T[k].conformal), threshold: T[k].threshold, positive: p >= T[k].threshold }
  }
  return { targets, attributions: att }
}
