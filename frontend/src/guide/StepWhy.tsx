import { useMemo } from 'react'
import { useApp } from '../lib/ctx'
import { GROUP_META, findSimilar, groupContributions, heatmapRows, sig } from '../lib/explain'
import { narrative, rank, valueText } from '../lib/format'
import { pct, riskHex } from '../lib/risk'
import { Term } from '../components/Term'
import type { Attribution, DatasetPatient, FeatureSpec, Inputs, TargetId } from '../lib/types'
import { TARGETS } from '../lib/types'

const TNAME: Record<TargetId, string> = { CAD: 'Overall CAD', LAD: 'LAD artery', LCX: 'LCX artery', RCA: 'RCA artery' }
const odds = (c: number) => (c >= 0 ? `×${Math.exp(c).toFixed(c > 1.6 ? 1 : 2)}` : `÷${Math.exp(-c).toFixed(-c > 1.6 ? 1 : 2)}`)

export function StepWhy() {
  const { pred, data, inputs, explainTarget: t, setExplainTarget, load } = useApp()
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])
  if (!pred) return null
  const att = pred.attributions[t]
  const ranked = rank(att, feats)
  const up = ranked.filter((r) => r.c > 0.02).slice(0, 3)
  const down = ranked.filter((r) => r.c < -0.02).slice(0, 3)
  const groups = groupContributions(att, data.features)

  return (
    <div className="page why">
      <section className="page-head">
        <h2>Why these numbers?</h2>
        <p>Every estimate is split into the push or pull of each answer. These are exact <Term k="SHAP">SHAP</Term> contributions from the model, not guesses.</p>
      </section>

      <div className="ttabs" role="tablist" aria-label="Which estimate to explain">
        {TARGETS.map((x) => (
          <button key={x} role="tab" aria-selected={t === x} onClick={() => setExplainTarget(x)}>
            <span className="tt-dot" style={{ background: riskHex(pred.targets[x].p) }} />
            {TNAME[x]} <b>{pct(pred.targets[x].p)}</b>
          </button>
        ))}
      </div>

      <section className="card why-summary">
        <p className="narrative big">{narrative(t, pred.targets[t].p, att, feats, inputs)}</p>
        <ForceBar att={att} feats={feats} inputs={inputs} />
      </section>

      <div className="why-grid">
        <section className="card">
          <h3>What raises it</h3>
          <div className="rcards">
            {up.length ? up.map((r) => <ReasonCard key={r.key} f={r.f} v={inputs[r.key]} c={r.c} />) : <p className="muted">Nothing is pushing this estimate up much.</p>}
          </div>
          <h3 style={{ marginTop: 16 }}>What lowers it</h3>
          <div className="rcards">
            {down.length ? down.map((r) => <ReasonCard key={r.key} f={r.f} v={inputs[r.key]} c={r.c} />) : <p className="muted">Nothing is pulling this estimate down much.</p>}
          </div>
        </section>

        <section className="card">
          <h3>Which part of the check-up matters most</h3>
          <p className="muted small">Each group’s combined push (red) or pull (teal), and its share of the whole explanation.</p>
          <div className="systems">
            {groups.map((g) => {
              const m = GROUP_META[g.group]
              const max = Math.max(...groups.map((x) => Math.abs(x.net)), 0.3)
              return (
                <div className="sys" key={g.group}>
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d={m.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div className="sys-l"><b>{m.label}</b><small>{g.top.filter((x) => Math.abs(x.c) > 0.02).slice(0, 2).map((x) => feats[x.key].label).join(', ') || m.blurb}</small></div>
                  <div className="sys-bar"><span className="axis" /><span className={`b ${g.net > 0 ? 'up' : 'down'}`} style={g.net > 0 ? { left: '50%', width: `${(g.net / max) * 50}%` } : { right: '50%', width: `${(-g.net / max) * 50}%` }} /></div>
                  <span className="sys-share">{Math.round(g.share * 100)}%</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="why-grid">
        <section className="card">
          <h3>One answer, four estimates</h3>
          <p className="muted small">How each answer moves each estimate. Colour shows direction, size shows strength. Hover a cell for the number.</p>
          <Heatmap />
        </section>
        <Similar onLoad={(p) => load(p.inputs, `dataset:${p.id}`)} />
      </div>

      <section className="card">
        <h3>The measurements</h3>
        <p className="muted small">Each value against its usual adult range, with how much it moves the {TNAME[t]} estimate.</p>
        <div className="mgrid">
          {data.features.filter((f) => f.kind === 'numeric' && f.normal).map((f) => {
            const v = Number(inputs[f.key]); const [lo, hi] = f.normal!
            const min = f.minimum ?? 0, max = f.maximum ?? 1
            const c = att.contributions[f.key] ?? 0
            const flag = v > hi ? 'High' : v < lo ? 'Low' : 'Normal'
            return (
              <div className="mtile" key={f.key}>
                <div className="mt-top"><span>{f.label}</span><span className={`flag ${flag === 'High' ? 'hi' : flag === 'Low' ? 'lo' : 'ok'}`}>{flag}</span></div>
                <div className="mt-val">{valueText(f, v)}</div>
                <div className="minirange wide">
                  <span className="nr" style={{ left: `${((Math.max(lo, min) - min) / (max - min)) * 100}%`, width: `${((Math.min(hi, max) - Math.max(lo, min)) / (max - min)) * 100}%` }} />
                  <span className="pt" style={{ left: `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%` }} />
                </div>
                <div className="mt-eff">{Math.abs(c) < 0.02 ? <span className="muted">barely affects the estimate</span> : <span className={c > 0 ? 'tone-high' : 'tone-low'}>{c > 0 ? 'raises' : 'lowers'} the odds {odds(c)}</span>}</div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function ReasonCard({ f, v, c }: { f: FeatureSpec; v: number | string; c: number }) {
  const m = GROUP_META[f.group]
  return (
    <div className={`rcard ${c > 0 ? 'up' : 'down'}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d={m.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div><b>{f.label}</b><small>{valueText(f, v)} · {m.label.toLowerCase()}</small></div>
      <span className="rc-eff" title={`${c > 0 ? '+' : ''}${c.toFixed(2)} log-odds`}>odds {odds(c)}</span>
    </div>
  )
}

/** SHAP force plot: red factors push from the left up to this patient's value, teal factors push back
 *  from the right. Axis in log-odds, labelled in probability. */
function ForceBar({ att, feats, inputs }: { att: Attribution; feats: Record<string, FeatureSpec>; inputs: Inputs }) {
  const W = 900, H = 100, pad = 24
  // small factors are merged into one block per side so the bar stays readable
  const all = Object.entries(att.contributions)
  const tot = all.reduce((s, [, c]) => s + Math.abs(c), 0) || 1
  const bigEnough = ([, c]: [string, number]) => Math.abs(c) / tot >= 0.035
  const merge = (xs: [string, number][], up: boolean) => {
    const big = xs.filter(bigEnough), small = xs.filter((x) => !bigEnough(x))
    const rest = small.reduce((s, [, c]) => s + c, 0)
    return Math.abs(rest) > 1e-6 ? [...big, [`__other_${up ? 'up' : 'down'}:${small.length}`, rest] as [string, number]] : big
  }
  const pos = merge(all.filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]), true)
  const neg = merge(all.filter(([, c]) => c < 0).sort((a, b) => a[1] - b[1]), false)
  const sp = pos.reduce((s, [, c]) => s + c, 0), sn = neg.reduce((s, [, c]) => s + c, 0)
  const lo = Math.min(att.base, att.value - sp) - 0.3, hi = Math.max(att.base, att.value - sn) + 0.3
  const x = (z: number) => pad + ((z - lo) / (hi - lo)) * (W - 2 * pad)
  const segs: { k: string; a: number; b: number; up: boolean }[] = []
  let cur = att.value - sp
  for (const [k, c] of [...pos].reverse()) { segs.push({ k, a: cur, b: cur + c, up: true }); cur += c }
  cur = att.value
  for (const [k, c] of neg) { segs.push({ k, a: cur, b: cur - c, up: false }); cur -= c }
  const name = (k: string) => k.startsWith('__other') ? `${k.split(':')[1]} small factors` : feats[k]?.label.split(' (')[0] ?? k
  const ticks = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((p) => ({ p, z: Math.log(p / (1 - p)) }))
    .filter((t) => t.z > lo && t.z < hi && Math.abs(x(t.z) - x(att.value)) > 40)
  return (
    <div className="force">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Force plot of contributions">
        {ticks.map((t) => <g key={t.p}><line x1={x(t.z)} x2={x(t.z)} y1={18} y2={H - 24} className="ft-grid" /><text x={x(t.z)} y={H - 8} textAnchor="middle" className="ft-tick">{Math.round(t.p * 100)}%</text></g>)}
        {segs.map((s) => {
          const x0 = x(Math.min(s.a, s.b)), x1 = x(Math.max(s.a, s.b)), w = Math.max(0.5, x1 - x0)
          const full = name(s.k)
          const room = Math.floor((w - 18) / 6.3)
          const label = full.length <= room ? full : room >= 5 ? full.slice(0, room - 1).trimEnd() + '…' : ''
          const fits = !!label
          const other = s.k.startsWith('__other')
          return (
            <g key={s.k}>
              <path d={s.up
                ? `M${x0},28 L${x0 + w - 7},28 L${x0 + w},44 L${x0 + w - 7},60 L${x0},60 L${x0 + 7},44 Z`
                : `M${x1},28 L${x1 - w + 7},28 L${x1 - w},44 L${x1 - w + 7},60 L${x1},60 L${x1 - 7},44 Z`}
                className={`fseg ${s.up ? 'up' : 'down'} ${other ? 'other' : ''}`}>
                <title>{other ? label : `${label}: ${valueText(feats[s.k], inputs[s.k])}`} ({s.up ? '+' : '−'}{Math.abs(s.b - s.a).toFixed(2)} log-odds)</title>
              </path>
              {fits && <text x={(x0 + x1) / 2} y={48} textAnchor="middle" className="fseg-l">{label}</text>}
            </g>
          )
        })}
        <line x1={x(att.base)} x2={x(att.base)} y1={14} y2={70} className="ft-base" />
        <text x={x(att.base)} y={11} textAnchor="middle" className="ft-lab">average patient {pct(sig(att.base))}</text>
        <line x1={x(att.value)} x2={x(att.value)} y1={20} y2={68} className="ft-val" />
        <text x={x(att.value)} y={H - 8} textAnchor="middle" className="ft-lab strong">this patient {pct(sig(att.value))}</text>
      </svg>
      <div className="force-key"><span className="k up" />raises the estimate <span className="k down" />lowers it · hover a block for details</div>
    </div>
  )
}

function Heatmap() {
  const { pred, data, inputs } = useApp()
  const feats = Object.fromEntries(data.features.map((f) => [f.key, f]))
  const rows = heatmapRows(pred!, 12)
  const max = Math.max(...rows.flatMap((r) => r.vals.map(Math.abs)), 0.2)
  return (
    <table className="heat">
      <thead><tr><th />{TARGETS.map((t) => <th key={t}><Term k={t}>{t}</Term></th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="heat-l">{feats[r.key].label}<small>{valueText(feats[r.key], inputs[r.key])}</small></td>
            {r.vals.map((v, i) => {
              const s = Math.sqrt(Math.abs(v) / max)
              return (
                <td key={i} title={`${feats[r.key].label} → ${TARGETS[i]}: ${v > 0 ? '+' : ''}${v.toFixed(2)} log-odds (odds ${odds(v)})`}>
                  <span className={`hcell ${v > 0 ? 'up' : 'down'}`} style={{ width: `${8 + s * 26}px`, height: `${8 + s * 26}px`, opacity: 0.25 + 0.75 * s }} />
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Similar({ onLoad }: { onLoad: (p: DatasetPatient) => void }) {
  const { data, inputs } = useApp()
  const res = useMemo(() => findSimilar(data.patients, data.features, data.similar_weights, inputs), [data, inputs])
  const n = (t: TargetId) => res.filter((p) => p.labels[t]).length
  return (
    <section className="card">
      <h3>12 similar real patients</h3>
      <p className="muted small">The closest matches in the dataset, and what their <Term k="angiography">angiogram</Term> actually showed. Tap one to load it.</p>
      <div className="sim-big">
        {TARGETS.map((t) => <div key={t}><b>{n(t)}<small>/12</small></b><span>{t === 'CAD' ? 'had CAD' : `${t} narrowed`}</span></div>)}
      </div>
      <div className="sim-dots">
        {res.map((p) => (
          <button key={p.id} className="sim-dot" onClick={() => onLoad(p)} title={`#${p.id + 1}: ${p.inputs.sex_male ? 'man' : 'woman'}, ${p.inputs.age}. Angiography: ${p.labels.CAD ? (['LAD', 'LCX', 'RCA'] as const).filter((v) => p.labels[v]).join(', ') + ' narrowed' : 'clear'}`}>
            <span className="sd-ring" style={{ borderColor: p.labels.CAD ? 'var(--high)' : 'var(--low)' }}>{p.inputs.sex_male ? 'M' : 'F'}{p.inputs.age}</span>
            <span className="sd-v">{(['LAD', 'LCX', 'RCA'] as const).map((v) => <i key={v} className={p.labels[v] ? 'on' : ''} title={v} />)}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Ring: red had CAD, teal did not. Three bars: LAD, LCX, RCA (filled = narrowed).</p>
    </section>
  )
}
