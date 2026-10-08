import { useMemo } from 'react'
import { useApp } from '../lib/ctx'
import { predictLocal } from '../lib/engine'
import { pct, riskHex } from '../lib/risk'
import { HeartStage } from './HeartStage'
import { suggestChanges } from '../components/Modifiable'
import { TARGETS, type TargetId } from '../lib/types'
import { Term } from '../components/Term'

const KNOBS = ['bp', 'ldl', 'hdl', 'tg', 'fbs', 'weight', 'pr']
const TNAME: Record<TargetId, string> = { CAD: 'Coronary artery disease', LAD: 'LAD narrowing', LCX: 'LCX narrowing', RCA: 'RCA narrowing' }

export function StepWhatIf() {
  const { data, inputs, baseline, onChange, setInputs, pred } = useApp()
  const before = useMemo(() => predictLocal(data.bundle, baseline).targets, [data.bundle, baseline])
  const tips = useMemo(() => suggestChanges(data.bundle, data.features, inputs).sort((a, b) => a.delta.CAD - b.delta.CAD), [data, inputs])
  const feats = Object.fromEntries(data.features.map((f) => [f.key, f]))
  const changed = Object.keys(inputs).filter((k) => String(inputs[k]) !== String(baseline[k]))
  if (!pred) return null

  return (
    <div className="page whatif">
      <section className="page-head">
        <h2>What if things were different?</h2>
        <p>Move a slider or switch a habit and watch the heart and the numbers change. This shows how the model responds, which is not the same as what a treatment would do.</p>
      </section>
      <div className="wi-grid">
        <section className="card">
          <h3>Change the patient</h3>
          {KNOBS.map((k) => {
            const f = feats[k]; const v = Number(inputs[k]); const b = Number(baseline[k])
            const lo = f.minimum ?? 0, hi = f.maximum ?? 100
            return (
              <div className="qs" key={k}>
                <div className="qs-top">
                  <label htmlFor={`wi-${k}`}><Term k={k}>{f.label}</Term></label>
                  <span className="qs-val">{f.step && f.step < 1 ? v.toFixed(1) : Math.round(v)} <small>{f.unit}</small>
                    {v !== b && <em className="was">was {Math.round(b)}</em>}</span>
                </div>
                <div className="range-wrap">
                  {f.normal && <div className="normal" style={{ left: `${((Math.max(f.normal[0], lo) - lo) / (hi - lo)) * 100}%`, width: `${((Math.min(f.normal[1], hi) - Math.max(f.normal[0], lo)) / (hi - lo)) * 100}%` }} />}
                  <span className="was-mark" style={{ left: `${((b - lo) / (hi - lo)) * 100}%` }} />
                  <input id={`wi-${k}`} type="range" min={lo} max={hi} step={f.step ?? 1} value={v} onChange={(e) => onChange(k, Number(e.target.value))} />
                </div>
              </div>
            )
          })}
          <div className="chiprow" style={{ marginTop: 10 }}>
            <button className="tchip" aria-pressed={Number(inputs.current_smoker) === 0 && Number(baseline.current_smoker) === 1}
              disabled={Number(baseline.current_smoker) !== 1}
              onClick={() => setInputs((s) => ({ ...s, current_smoker: Number(s.current_smoker) ? 0 : 1, ex_smoker: Number(s.current_smoker) ? 1 : Number(baseline.ex_smoker) }))}>
              {Number(baseline.current_smoker) === 1 ? 'Stop smoking' : 'Not a smoker'}
            </button>
            <button className="tchip" onClick={() => setInputs(() => baseline)} disabled={!changed.length}>Undo all changes</button>
          </div>
          {tips.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>One-tap scenarios</h3>
              <div className="mods">
                {tips.map((c) => (
                  <button key={c.key} className="mod" onClick={() => setInputs((s) => ({ ...s, ...c.patch }))}>
                    <span className="mod-l"><b>{c.label}</b><small>{c.from} → {c.to}</small></span>
                    <span className={`mod-d ${c.delta.CAD < -0.005 ? 'down' : c.delta.CAD > 0.005 ? 'up' : ''}`}>{c.delta.CAD > 0 ? '+' : c.delta.CAD < 0 ? '−' : '±'}{Math.abs(c.delta.CAD * 100).toFixed(1)} pts</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card wi-right">
          <div className="wi-stage"><HeartStage compact /></div>
          <h3>Before and after</h3>
          <div className="ba">
            {TARGETS.map((t) => {
              const a = before[t].p, b = pred.targets[t].p, d = b - a
              return (
                <div className="ba-row" key={t}>
                  <span className="ba-name"><Term k={t}>{TNAME[t]}</Term></span>
                  <span className="ba-track">
                    <span className="ba-was" style={{ left: `${a * 100}%` }} title={`Before: ${pct(a)}`} />
                    <span className="ba-now" style={{ width: `${b * 100}%`, background: riskHex(b) }} />
                  </span>
                  <span className="ba-p">{pct(b)}</span>
                  <span className={`ba-d ${d < -0.005 ? 'down' : d > 0.005 ? 'up' : ''}`}>{Math.abs(d) < 0.005 ? 'no change' : `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts`}</span>
                </div>
              )
            })}
          </div>
          <p className="muted small">The thin mark is where each estimate started. Associations in 303 patients are not proof of cause and effect: for example, lower LDL can look riskier because people with known heart disease are often already on cholesterol medicine.</p>
        </section>
      </div>
    </div>
  )
}
