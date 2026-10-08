import { useMemo, useState } from 'react'
import { useApp } from '../lib/ctx'
import { buildPdf, downloadBlob, exportCsv, exportJson, statusWord, type ReportInput } from '../lib/report'
import { findSimilar } from '../lib/explain'
import { narrative } from '../lib/format'
import { pct, riskHex } from '../lib/risk'
import { HeartStage } from './HeartStage'
import { TARGETS, type TargetId } from '../lib/types'

const TNAME: Record<TargetId, string> = { CAD: 'Coronary artery disease', LAD: 'LAD narrowing', LCX: 'LCX narrowing', RCA: 'RCA narrowing' }

export function sourceLabel(source: string, presets: { id: string; label: string }[]) {
  if (source.startsWith('dataset:')) return `Dataset patient #${Number(source.slice(8)) + 1}`
  if (source.startsWith('preset:')) return `Example: ${presets.find((p) => `preset:${p.id}` === source)?.label ?? 'patient'}`
  return 'Custom patient'
}

export function StepReport() {
  const { pred, data, inputs, baseline, source } = useApp()
  const [msg, setMsg] = useState<string | null>(null)
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])
  const similar = useMemo(() => findSimilar(data.patients, data.features, data.similar_weights, inputs), [data, inputs])
  if (!pred) return null
  const edited = JSON.stringify(inputs) !== JSON.stringify(baseline)
  const src = sourceLabel(source, data.presets) + (edited ? ' (edited)' : '')

  const rin = (): ReportInput => {
    const c = document.querySelector('.stage canvas') as HTMLCanvasElement | null
    let snap: string | null = null
    try { snap = c ? c.toDataURL('image/png') : null } catch { snap = null }
    return { pred, inputs, features: data.features, card: data.card, source: src, snapshot: snap, similar }
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const go = async (kind: 'pdf' | 'json' | 'csv') => {
    try {
      const r = rin()
      const res = kind === 'pdf' ? await downloadBlob(`cardiolens-report-${stamp}.pdf`, buildPdf(r).output('blob'))
        : kind === 'json' ? await downloadBlob(`cardiolens-${stamp}.json`, exportJson(r))
        : await downloadBlob(`cardiolens-${stamp}.csv`, exportCsv(r))
      setMsg(res === 'saved' ? `${kind.toUpperCase()} saved.` : res === 'declined' ? 'Download cancelled.'
        : `Your ${kind.toUpperCase()} is downloading. If nothing happens, open the app in its own browser tab.`)
    } catch (e) {
      setMsg(`Could not create the file: ${String(e)}`)
    }
  }

  return (
    <div className="page report">
      <section className="page-head">
        <h2>Take it with you</h2>
        <p>Download a two-page PDF summary with the 3D view, the estimates and the reasons behind them, or export the raw numbers.</p>
      </section>
      <div className="rep-grid">
        <section className="card rep-preview" aria-label="Report preview">
          <div className="rp-band"><b>CardioLens 3D · coronary risk report</b><span>{src} · {new Date().toLocaleDateString()}</span></div>
          <div className="rp-warn">For decision support and education only. Not a diagnosis.</div>
          <div className="rp-top">
            <div className="rp-img"><HeartStage compact /></div>
            <table className="rp-table">
              <tbody>
                {TARGETS.map((t) => (
                  <tr key={t}>
                    <td><span className="dot" style={{ background: riskHex(pred.targets[t].p) }} /> {TNAME[t]}</td>
                    <td className="r"><b>{pct(pred.targets[t].p)}</b></td>
                    <td className="muted">{statusWord(pred.targets[t], t === 'CAD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {TARGETS.map((t) => <p key={t} className="rp-p"><b>{TNAME[t]}.</b> {narrative(t, pred.targets[t].p, pred.attributions[t], feats, inputs).replace(/^Estimated probability of [^:]+: [^.]+\.\s*/, '')}</p>)}
          <p className="rp-p muted">Of the 12 most similar real patients, {similar.filter((p) => p.labels.CAD).length} had coronary artery disease on angiography.</p>
          <p className="rp-p muted small">The PDF adds the full factor breakdown, body-system chart, measurement table, model validation and all inputs.</p>
        </section>
        <aside className="rep-actions">
          <button className="dl" onClick={() => go('pdf')}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span><b>Download PDF report</b><small>2 pages, A4, with the 3D snapshot</small></span>
          </button>
          <button className="dl ghost" onClick={() => go('csv')}><span><b>Download spreadsheet (CSV)</b><small>Every input with its contribution to each estimate</small></span></button>
          <button className="dl ghost" onClick={() => go('json')}><span><b>Download data (JSON)</b><small>Inputs, predictions, intervals and attributions</small></span></button>
          {msg && <p className="muted small" role="status">{msg}</p>}
          <p className="muted small">The 3D picture in the PDF is taken from the preview on the left; rotate it first if you want a different angle.</p>
        </aside>
      </div>
    </div>
  )
}
