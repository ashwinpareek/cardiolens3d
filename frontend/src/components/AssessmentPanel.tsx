import { useMemo } from 'react'
import { Bullseye } from './Bullseye'
import { Modifiable } from './Modifiable'
import type { Bundle } from '../lib/engine'
import { narrative, rank, valueText } from '../lib/format'
import { pct, riskBand, riskHex } from '../lib/risk'
import type { FeatureSpec, Inputs, Prediction, TargetId, VesselId } from '../lib/types'
import { VESSELS } from '../lib/types'

interface Props {
  pred: Prediction | null
  features: FeatureSpec[]
  inputs: Inputs
  selected: VesselId | null
  onSelect: (v: VesselId | null) => void
  explainTarget: TargetId
  onExplainTarget: (t: TargetId) => void
  alpha: number
  bundle: Bundle
  onApply: (patch: Inputs) => void
}

const VESSEL_NAMES: Record<VesselId, string> = {
  LAD: 'Left anterior descending',
  LCX: 'Left circumflex',
  RCA: 'Right coronary artery',
}

export function verdictText(t: TargetId, set: (0 | 1)[], alpha: number) {
  const conf = Math.round((1 - alpha) * 100)
  const pos = t === 'CAD' ? 'CAD present' : 'stenotic'
  const neg = t === 'CAD' ? 'CAD absent' : 'not stenotic'
  if (set.length === 2) return { tone: 'mid', text: <>At {conf}% confidence the model <b>cannot decide</b> between {neg} and {pos}. Treat this as uncertain.</> }
  if (set.length === 0) return { tone: 'mid', text: <>This profile is <b>unlike the training data</b>; neither outcome is supported at {conf}% confidence.</> }
  return set[0] === 1
    ? { tone: 'high', text: <>At {conf}% confidence the prediction set is <b>{pos}</b> only.</> }
    : { tone: 'low', text: <>At {conf}% confidence the prediction set is <b>{neg}</b> only.</> }
}

export function AssessmentPanel({ pred, features, inputs, selected, onSelect, explainTarget, onExplainTarget, alpha, bundle, onApply }: Props) {
  const feats = useMemo(() => Object.fromEntries(features.map((f) => [f.key, f])), [features])
  if (!pred) return <aside className="rail rail-right"><div className="section"><p className="hint">Scoring…</p></div></aside>
  const cad = pred.targets.CAD
  const band = riskBand(cad.p)
  const v = verdictText('CAD', cad.set, alpha)
  const risks = { LAD: pred.targets.LAD.p, LCX: pred.targets.LCX.p, RCA: pred.targets.RCA.p }

  const att = pred.attributions[explainTarget]
  const tp = pred.targets[explainTarget]
  const ranked = rank(att, feats)
  const top = ranked.slice(0, 9)
  const rest = ranked.slice(9).reduce((s, r) => s + r.c, 0)
  const maxAbs = Math.max(0.25, ...top.map((r) => Math.abs(r.c)), Math.abs(rest))

  return (
    <aside className="rail rail-right" aria-label="Risk assessment">
      <div className="section">
        <div className="headline">
          <div className="big" style={{ color: riskHex(cad.p) }}>{pct(cad.p)}</div>
          <div>
            <div className="what">Probability of coronary artery disease</div>
            <div className="band">{band.label} risk</div>
            <div className="ci">90% interval {pct(cad.lo)}–{pct(cad.hi)}</div>
          </div>
        </div>
        <div className="verdict"><span className="dot" style={{ background: `var(--${v.tone})` }} /><span>{v.text}</span></div>
      </div>

      <div className="section">
        <h3>Vessel stenosis (≥50%)</h3>
        <div className="vessels">
          {VESSELS.map((id) => {
            const t = pred.targets[id]
            const unsure = t.set.length !== 1
            return (
              <button key={id} className="vrow" aria-pressed={selected === id}
                onClick={() => { onSelect(selected === id ? null : id); onExplainTarget(selected === id ? 'CAD' : id) }}>
                <span className="name">{id}</span>
                <span className="track" aria-hidden>
                  <span className="fill" style={{ width: pct(t.p, 1), background: riskHex(t.p) }} />
                  <span className="whisk" style={{ left: pct(t.lo, 1), width: pct(Math.max(0.004, t.hi - t.lo), 1) }} />
                  <span className="thr" style={{ left: pct(t.threshold, 1) }} title={`Operating threshold ${pct(t.threshold)}`} />
                </span>
                <span className="pv">{pct(t.p)}</span>
                <span className="sub">{VESSEL_NAMES[id]} · {unsure ? 'uncertain' : t.set[0] ? 'likely stenotic' : 'likely patent'}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="section">
        <h3>Territory map</h3>
        <div className="bullseye-wrap">
          <Bullseye risks={risks} selected={selected} onSelect={(id) => { onSelect(id); onExplainTarget(id) }} />
          <p>The 17 standard left-ventricular segments, each coloured by the risk of the artery that usually supplies it. It shows where ischaemia would be expected if the predicted vessel were narrowed, not where a lesion was seen.</p>
        </div>
      </div>

      <div className="section">
        <div className="why-head">
          <h3 style={{ margin: 0 }}>Why this estimate</h3>
          <div className="seg" role="tablist" aria-label="Explain target">
            {(['CAD', 'LAD', 'LCX', 'RCA'] as TargetId[]).map((t) => (
              <button key={t} role="tab" aria-pressed={explainTarget === t} aria-selected={explainTarget === t}
                onClick={() => { onExplainTarget(t); onSelect(t === 'CAD' ? null : (t as VesselId)) }}>{t}</button>
            ))}
          </div>
        </div>
        <p className="narrative">{narrative(explainTarget, tp.p, att, feats, inputs)}</p>
        <div className="wf" role="list">
          {top.map((r) => (
            <div className="wf-row" role="listitem" key={r.key} title={`${r.c > 0 ? '+' : ''}${r.c.toFixed(3)} log-odds`}>
              <span className="lbl">{r.f.label}<small>{valueText(r.f, inputs[r.key])}</small></span>
              <span className="wf-bar">
                <span className="axis" />
                <span className={`b ${r.c > 0 ? 'up' : 'down'}`}
                  style={r.c > 0 ? { left: '50%', width: `${(r.c / maxAbs) * 50}%` } : { right: '50%', width: `${(-r.c / maxAbs) * 50}%` }} />
              </span>
              <span className="val">{r.c > 0 ? '+' : ''}{r.c.toFixed(2)}</span>
            </div>
          ))}
          {ranked.length > 9 && (
            <div className="wf-row" role="listitem">
              <span className="lbl" style={{ color: 'var(--muted)' }}>{ranked.length - 9} other factors</span>
              <span className="wf-bar"><span className="axis" />
                <span className={`b ${rest > 0 ? 'up' : 'down'}`} style={{ opacity: 0.5, ...(rest > 0 ? { left: '50%', width: `${(rest / maxAbs) * 50}%` } : { right: '50%', width: `${(-rest / maxAbs) * 50}%` }) }} />
              </span>
              <span className="val">{rest > 0 ? '+' : ''}{rest.toFixed(2)}</span>
            </div>
          )}
        </div>
        <div className="wf-foot">
          <span>Reference patient {pct(1 / (1 + Math.exp(-att.base)))}</span>
          <span>log-odds · red raises, teal lowers</span>
          <span>This patient {pct(1 / (1 + Math.exp(-att.value)))}</span>
        </div>
      </div>
      <Modifiable bundle={bundle} features={features} inputs={inputs} target={explainTarget} onApply={onApply} />
    </aside>
  )
}
