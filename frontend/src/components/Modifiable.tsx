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

/** Improving a value should never be shown as raising risk on screen without explanation. In this
 *  dataset some do (no medication data: treated patients have "better" numbers), so such changes are
 *  split out and labelled as a dataset artifact instead of being offered as advice. */
export const WRONG_WAY = 0.0005
export function splitChanges(items: Change[], target: TargetId) {
  return { helps: items.filter((c) => c.delta[target] <= WRONG_WAY), odd: items.filter((c) => c.delta[target] > WRONG_WAY) }
}

export function Modifiable({ bundle, features, inputs, target, onApply }: { bundle: Bundle; features: FeatureSpec[]; inputs: Inputs; target: TargetId; onApply: (patch: Inputs) => void }) {
  const items = useMemo(() => suggestChanges(bundle, features, inputs).sort((a, b) => a.delta[target] - b.delta[target]), [bundle, features, inputs, target])
  const { helps, odd } = splitChanges(items, target)
  const all = helps.reduce((s, c) => ({ ...s, ...c.patch }), {} as Inputs)
  return (
    <div className="section">
      <div className="why-head">
        <h3 style={{ margin: 0 }}>Modifiable factors</h3>
        {helps.length > 1 && <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onApply(all)}>Apply all</button>}
      </div>
      {items.length === 0 ? (
        <p className="hint">Every modifiable measurement is already inside its reference range.</p>
      ) : (
        <>
          <p className="hint">How the {target} estimate moves if one out-of-range factor is brought to the edge of its reference range. This is the model's sensitivity, learned from 303 patients; it is not a treatment effect.</p>
          {helps.length > 0 ? (
            <div className="mods">
              {helps.map((c) => {
                const d = c.delta[target]
                return (
                  <button key={c.key} className="mod" onClick={() => onApply(c.patch)} title="Apply this change to the patient">
                    <span className="mod-l"><b>{c.label}</b><small>{c.from} → {c.to}</small></span>
                    <span className={`mod-d ${d < -0.005 ? 'down' : ''}`}>{d < -0.0005 ? '−' : '±'}{Math.abs(d * 100).toFixed(1)} pts</span>
                  </button>
                )
              })}
            </div>
          ) : <p className="hint">None of this patient's out-of-range factors lowers the {target} estimate in this model.</p>}
          {odd.length > 0 && <OddFactors odd={odd} target={target} />}
        </>
      )}
    </div>
  )
}

/** Changes that move the estimate the "wrong" way: shown collapsed, explained, never as a button. */
export function OddFactors({ odd, target }: { odd: Change[]; target: TargetId }) {
  return (
    <details className="odd">
      <summary>{odd.length} healthy change{odd.length > 1 ? 's' : ''} the model does not reward ({odd.map((c) => c.label).join(', ')})</summary>
      <p>In this dataset, {odd.map((c) => `“${c.label}” (${c.from} → ${c.to}) moves the ${target} estimate up by ${(c.delta[target] * 100).toFixed(1)} pts`).join('; ')}. This is a dataset artifact, not advice: the data do not record medicines, so patients already treated for known heart disease (statins, diet, weight loss) tend to have "better" numbers. The model learns that association. In real life these changes lower cardiovascular risk.</p>
    </details>
  )
}
