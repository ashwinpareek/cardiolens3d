import { narrative, rank, valueText } from '../lib/format'
import { pct } from '../lib/risk'
import type { FeatureSpec, Inputs, Prediction, TargetId } from '../lib/types'
import { TARGETS } from '../lib/types'
import { verdictText } from './AssessmentPanel'

export interface ReportData { img: string; when: string; source: string }

/** Print-only one-page summary (shown only under @media print). */
export function Report({ data, pred, features, inputs, alpha, card }: { data: ReportData | null; pred: Prediction | null; features: FeatureSpec[]; inputs: Inputs; alpha: number; card: any }) {
  if (!data || !pred) return null
  const feats = Object.fromEntries(features.map((f) => [f.key, f]))
  const names: Record<TargetId, string> = { CAD: 'Coronary artery disease', LAD: 'LAD stenosis', LCX: 'LCX stenosis', RCA: 'RCA stenosis' }
  return (
    <div className="print-report">
      <header>
        <h1>CardioLens 3D · coronary risk summary</h1>
        <p>{data.when} · {data.source} · model trained {card.created.slice(0, 10)} on {card.dataset.n} patients ({card.dataset.name})</p>
      </header>
      <div className="pr-warn">For decision support and education only. Not a diagnosis and not a substitute for coronary angiography, CT coronary angiography or clinical judgement.</div>
      <div className="pr-grid">
        <img src={data.img} alt="3D heart coloured by predicted vessel risk" />
        <table>
          <thead><tr><th>Target</th><th>Probability</th><th>90% interval</th><th>Conformal set ({Math.round((1 - alpha) * 100)}%)</th></tr></thead>
          <tbody>
            {TARGETS.map((t) => {
              const p = pred.targets[t]
              return (
                <tr key={t}>
                  <td>{names[t]}</td><td><b>{pct(p.p)}</b></td><td>{pct(p.lo)}–{pct(p.hi)}</td>
                  <td>{p.set.length === 2 ? 'uncertain' : p.set.length === 0 ? 'atypical profile' : p.set[0] ? 'positive' : 'negative'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {TARGETS.map((t) => (
        <section key={t}>
          <h2>{names[t]}</h2>
          <p>{narrative(t, pred.targets[t].p, pred.attributions[t], feats, inputs)} {t === 'CAD' ? verdictText('CAD', pred.targets.CAD.set, alpha).text : null}</p>
          <p className="pr-small">Top factors: {rank(pred.attributions[t], feats).slice(0, 6).map((r) => `${r.f.label} (${valueText(r.f, inputs[r.key])}) ${r.c > 0 ? '+' : ''}${r.c.toFixed(2)}`).join('; ')}</p>
        </section>
      ))}
      <h2>Inputs</h2>
      <p className="pr-small">{features.map((f) => `${f.label}: ${valueText(f, inputs[f.key])}`).join(' · ')}</p>
      <p className="pr-small">Validation: ROC-AUC {TARGETS.map((t) => `${t} ${card.targets[t].metrics.auc[0].toFixed(2)}`).join(', ')} (repeated nested cross-validation). Attributions are exact additive log-odds contributions relative to the dataset reference patient.</p>
    </div>
  )
}
