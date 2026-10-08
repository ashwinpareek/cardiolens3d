import { useMemo } from 'react'
import { HeartStage } from './HeartStage'
import { Gauge } from '../components/Gauge'
import { Term } from '../components/Term'
import { useApp } from '../lib/ctx'
import { pct, riskHex } from '../lib/risk'
import { rank, valueText } from '../lib/format'
import type { TargetId, VesselId } from '../lib/types'

export const VESSEL_INFO: Record<VesselId, { name: string; nick: string; feeds: string }> = {
  LAD: { name: 'Left anterior descending', nick: 'front of the heart', feeds: 'Front wall and most of the septum' },
  LCX: { name: 'Left circumflex', nick: 'left side and back', feeds: 'Side and back wall of the left ventricle' },
  RCA: { name: 'Right coronary artery', nick: 'right side and bottom', feeds: 'Right ventricle and bottom wall' },
}

export function status(p: number, thr: number, set: (0 | 1)[]) {
  if (set.length !== 1) return { word: 'Unclear', tone: 'mid', long: 'the model cannot decide either way' }
  return set[0] === 1 || p >= thr
    ? { word: 'Likely narrowed', tone: 'high', long: 'likely to have a significant narrowing' }
    : { word: 'Likely clear', tone: 'low', long: 'probably free of significant narrowing' }
}

export function StepHeart({ onWhy }: { onWhy: (t: TargetId) => void }) {
  const { pred, selected, setSelected, data, inputs, setExplainTarget } = useApp()
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])
  if (!pred) return null
  const cad = pred.targets.CAD
  const cadSt = cad.set.length !== 1 ? 'The model is unsure. Further testing would settle it.' : cad.set[0] ? 'Coronary artery disease is likely.' : 'Coronary artery disease is unlikely.'

  return (
    <div className="heart-page">
      <HeartStage />
      <aside className="heart-side" aria-label="Result">
        <section className="card result-card">
          <h3>Chance of <Term k="CAD">coronary artery disease</Term></h3>
          <Gauge p={cad.p} lo={cad.lo} hi={cad.hi} size={240} label="Coronary artery disease" />
          <p className="verdict-line">{cadSt}</p>
          <p className="muted small"><Term k="likely range">Likely range</Term> {pct(cad.lo)} to {pct(cad.hi)}. Based on 303 patients who had <Term k="angiography">angiography</Term>.</p>
        </section>

        <section className="card">
          <h3>The three main arteries</h3>
          <p className="muted small">Tap one to fly to it and see why.</p>
          <div className="arteries">
            {(['LAD', 'LCX', 'RCA'] as VesselId[]).map((v) => {
              const t = pred.targets[v]
              const st = status(t.p, t.threshold, t.set)
              return (
                <button key={v} className={`artery ${selected === v ? 'is-on' : ''}`} onClick={() => { setSelected(selected === v ? null : v); setExplainTarget(v) }} aria-pressed={selected === v}>
                  <span className="artery-dot" style={{ background: riskHex(t.p) }} />
                  <span className="artery-name"><b><Term k={v}>{v}</Term></b><small>{VESSEL_INFO[v].nick}</small></span>
                  <span className={`artery-st tone-${st.tone}`}><Term k={st.word}>{st.word}</Term></span>
                  <span className="artery-p">{pct(t.p)}</span>
                </button>
              )
            })}
          </div>
        </section>

        {selected && (() => {
          const t = pred.targets[selected]
          const st = status(t.p, t.threshold, t.set)
          const r = rank(pred.attributions[selected], feats)
          const up = r.filter((x) => x.c > 0.03).slice(0, 3)
          const down = r.filter((x) => x.c < -0.03).slice(0, 2)
          return (
            <section className="card story">
              <h3>{VESSEL_INFO[selected].name}</h3>
              <p><b style={{ color: riskHex(t.p) }}>{pct(t.p)}</b> chance of a significant <Term k="stenosis">narrowing</Term>. Verdict: <b className={`tone-${st.tone}`}><Term k={st.word}>{st.word.toLowerCase()}</Term></b>.</p>
              <p className="muted small">Feeds: {VESSEL_INFO[selected].feeds} (its <Term k="territory">territory</Term>).</p>
              {up.length > 0 && <div className="reasons"><span className="rh up">Pushing it up</span>{up.map((x) => <span key={x.key} className="rchip up"><Term k={x.key}>{x.f.label}</Term> <small>{valueText(x.f, inputs[x.key])}</small></span>)}</div>}
              {down.length > 0 && <div className="reasons"><span className="rh down">Holding it down</span>{down.map((x) => <span key={x.key} className="rchip down"><Term k={x.key}>{x.f.label}</Term> <small>{valueText(x.f, inputs[x.key])}</small></span>)}</div>}
              <button className="btn" onClick={() => onWhy(selected)}>Full explanation</button>
            </section>
          )
        })()}

        <button className="btn primary big wide" onClick={() => onWhy(selected ?? 'CAD')}>Why these numbers?</button>
      </aside>
    </div>
  )
}
