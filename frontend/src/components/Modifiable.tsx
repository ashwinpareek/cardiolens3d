import { useMemo } from 'react'
import { predictLocal, Bundle } from '../lib/engine'
import { lower, valueText } from '../lib/format'
import type { FeatureSpec, Inputs, TargetId } from '../lib/types'

interface Change { key: string; label: string; from: string; to: string; patch: Inputs; delta: Record<TargetId, number> }

/** For each modifiable factor that is outside its reference range, re-score the patient with that
 *  single factor moved to the edge of the range. Shows model sensitivity, not a treatment effect. */
export function suggestChanges(bundle: Bundle, features: FeatureSpec[], inputs: Inputs): Change[] {
  const base = predictLocal(bundle, inputs).targets
  const out: Change[] = []
  const add = (key: string, label: string, from: string, to: string, patch: Inputs) => {
    const x = { ...inputs, ...patch }
    const t = predictLocal(bundle, x).targets
    const delta = Object.fromEntries((Object.keys(t) as TargetId[]).map((k) => [k, t[k].p - base[k].p])) as Record<TargetId, number>
    out.push({ key, label, from, to, patch, delta })
  }
  for (const f of features) {
    if (!f.modifiable) continue
    const v = Number(inputs[f.key])
    if (f.key === 'current_smoker') {
      if (v === 1) add(f.key, 'Stop smoking', 'current smoker', 'ex-smoker', { current_smoker: 0, ex_smoker: 1 })
      continue
    }
    if (f.key === 'bmi' || f.key === 'weight') {
      if (f.key === 'bmi' && v > 25) {
        const h = Number(inputs.height) / 100
        const w = Math.round(24.9 * h * h)
        add('bmi', 'Reach BMI 24.9', `${v.toFixed(1)} kg/m²`, '24.9 kg/m²', { weight: w, bmi: 24.9, obesity: 0 })
      }
      continue
    }
    if (f.kind !== 'numeric' || !f.normal) continue
    const [lo, hi] = f.normal
    if (v > hi && f.key !== 'hdl') add(f.key, `Lower ${lower(f.label.replace(/\s*\(.*\)/, ''))}`, valueText(f, v), valueText(f, hi), { [f.key]: hi })
    if (v < lo && f.key === 'hdl') add(f.key, 'Raise HDL cholesterol', valueText(f, v), valueText(f, lo), { [f.key]: lo })
  }
  return out
}

export function Modifiable({ bundle, features, inputs, target, onApply }: { bundle: Bundle; features: FeatureSpec[]; inputs: Inputs; target: TargetId; onApply: (patch: Inputs) => void }) {
  const items = useMemo(() => suggestChanges(bundle, features, inputs).sort((a, b) => a.delta[target] - b.delta[target]), [bundle, features, inputs, target])
  const all = items.reduce((s, c) => ({ ...s, ...c.patch }), {} as Inputs)
  return (
    <div className="section">
      <div className="why-head">
        <h3 style={{ margin: 0 }}>Modifiable factors</h3>
        {items.length > 1 && <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onApply(all)}>Apply all</button>}
      </div>
      {items.length === 0 ? (
        <p className="hint">Every modifiable measurement is already inside its reference range.</p>
      ) : (
        <>
          <p className="hint">How the {target} estimate moves if one out-of-range factor is brought to the edge of its reference range. This is the model's sensitivity, learned from 303 patients; it is not a treatment effect.</p>
          {items.some((c) => c.delta[target] > 0.005) && (
            <p className="hint">Where improving a value raises the estimate (often LDL), the model is probably echoing treatment in the source population, for example statins in patients already known to have disease. The dataset does not record medications. Read it as a caution, not a recommendation.</p>
          )}
          <div className="mods">
            {items.map((c) => {
              const d = c.delta[target]
              return (
                <button key={c.key} className="mod" onClick={() => onApply(c.patch)} title="Apply this change to the patient">
                  <span className="mod-l"><b>{c.label}</b><small>{c.from} → {c.to}</small></span>
                  <span className={`mod-d ${d < -0.005 ? 'down' : d > 0.005 ? 'up' : ''}`}>{d > 0 ? '+' : d < 0 ? '−' : '±'}{Math.abs(d * 100).toFixed(1)} pts</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
