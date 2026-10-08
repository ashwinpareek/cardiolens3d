import { useMemo, useState } from 'react'
import { LineChart, SERIES_COLORS } from './LineChart'
import { pct } from '../lib/risk'
import { valueText } from '../lib/format'
import type { DatasetPatient, FeatureSpec, Inputs, ModelCard, Prediction, TargetId } from '../lib/types'
import { TARGETS } from '../lib/types'

type Tab = 'measurements' | 'similar' | 'evidence'

const ALGO: Record<string, string> = {
  logreg_l2: 'Logistic regression, L2', logreg_l1: 'Logistic regression, L1', svm_rbf: 'SVM (RBF kernel)',
  random_forest: 'Random forest', extra_trees: 'Extra trees', lightgbm: 'LightGBM', xgboost: 'XGBoost',
  catboost: 'CatBoost', ebm: 'Explainable Boosting Machine',
}

interface Props {
  pred: Prediction | null
  card: ModelCard
  features: FeatureSpec[]
  inputs: Inputs
  patients: DatasetPatient[]
  explainTarget: TargetId
  onLoadPatient: (p: DatasetPatient) => void
  similarWeights: Record<string, number>
}

export function Drawer(p: Props) {
  const [tab, setTab] = useState<Tab>('measurements')
  const [open, setOpen] = useState(true)
  const [big, setBig] = useState(false)
  return (
    <section className={`drawer ${open ? '' : 'collapsed'} ${big && open ? 'big' : ''}`} aria-label="Details">
      <div className="tabs" role="tablist">
        {([['measurements', 'Measurements'], ['similar', 'Similar patients'], ['evidence', 'Model evidence']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpen(true); if (k === 'evidence') setBig(true) }}>{l}</button>
        ))}
        <span className="spacer" />
        {open && <button onClick={() => setBig(!big)}>{big ? 'Shrink' : 'Expand'}</button>}
        <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
      </div>
      <div className="drawer-body" role="tabpanel">
        {tab === 'measurements' && <Measurements {...p} />}
        {tab === 'similar' && <Similar {...p} />}
        {tab === 'evidence' && <Evidence card={p.card} />}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ measurements */
function Measurements({ pred, features, inputs, explainTarget }: Props) {
  if (!pred) return null
  const att = pred.attributions[explainTarget].contributions
  const total = Object.values(att).reduce((s, v) => s + Math.abs(v), 0) || 1
  const rows = features.filter((f) => f.kind === 'numeric' || f.key === 'rwma' || f.key === 'function_class')
  const maxAbs = Math.max(0.2, ...rows.map((f) => Math.abs(att[f.key] ?? 0)))
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Measurement</th><th className="r">Value</th><th>Reference range</th><th>Status</th>
          <th>Contribution ({explainTarget})</th><th className="r">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const v = Number(inputs[f.key])
          const c = att[f.key] ?? 0
          const lo = f.minimum ?? 0, hi = f.maximum ?? 1
          const nr = f.normal
          const status = !nr ? null : v > nr[1] ? 'hi' : v < nr[0] ? 'lo' : 'ok'
          return (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="r">{valueText(f, v)}</td>
              <td>
                {nr ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="minirange">
                      <span className="nr" style={{ left: `${((Math.max(nr[0], lo) - lo) / (hi - lo)) * 100}%`, width: `${((Math.min(nr[1], hi) - Math.max(nr[0], lo)) / (hi - lo)) * 100}%` }} />
                      <span className="pt" style={{ left: `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%` }} />
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>{nr[0]}–{nr[1]}</span>
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
              </td>
              <td>{status && <span className={`flag ${status}`}>{status === 'hi' ? 'High' : status === 'lo' ? 'Low' : 'In range'}</span>}</td>
              <td>
                <span className="contrib" title={`${c > 0 ? '+' : ''}${c.toFixed(3)} log-odds`}>
                  <span className="axis" />
                  <span className="b" style={{ background: c > 0 ? 'var(--high)' : 'var(--low)', ...(c > 0 ? { left: '50%', width: `${(c / maxAbs) * 50}%` } : { right: '50%', width: `${(-c / maxAbs) * 50}%` }) }} />
                </span>
              </td>
              <td className="r">{((Math.abs(c) / total) * 100).toFixed(0)}%</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ------------------------------------------------------------------ similar patients */
function Similar({ features, inputs, patients, onLoadPatient, similarWeights }: Props) {
  const res = useMemo(() => {
    // standardised, importance-weighted distance (weights = mean |SHAP| for CAD)
    const num = features.filter((f) => f.kind !== 'categorical')
    const stats = Object.fromEntries(num.map((f) => {
      const xs = patients.map((p) => Number(p.inputs[f.key]))
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1
      return [f.key, [m, sd]]
    }))
    const d = patients.map((p) => {
      let s = 0
      for (const f of num) {
        const [, sd] = stats[f.key]
        const w = similarWeights[f.key] ?? 0.05
        s += w * ((Number(p.inputs[f.key]) - Number(inputs[f.key])) / sd) ** 2
      }
      s += (p.inputs.bbb !== inputs.bbb ? 1 : 0) * (similarWeights.bbb ?? 0.05)
      return { p, d: Math.sqrt(s) }
    })
    d.sort((a, b) => a.d - b.d)
    return d.slice(0, 12)
  }, [features, inputs, patients, similarWeights])

  const k = res.length
  const counts = Object.fromEntries(TARGETS.map((t) => [t, res.filter((r) => r.p.labels[t]).length]))
  return (
    <>
      <p className="hint" style={{ marginBottom: 8 }}>The {k} dataset patients closest to this profile, weighted by how much each feature matters to the model, with what angiography actually showed. Click a row to load that patient.</p>
      <div className="sim-summary">
        {TARGETS.map((t) => <div key={t}><b>{counts[t]} of {k}</b>{t === 'CAD' ? 'had CAD' : `${t} stenotic`}</div>)}
      </div>
      <table className="data">
        <thead><tr><th>Patient</th><th>Sex, age</th><th>Chest pain</th><th className="r">EF</th><th className="r">RWMA</th><th>DM / HTN</th><th>CAD</th><th>LAD</th><th>LCX</th><th>RCA</th><th className="r">Model (out-of-fold)</th></tr></thead>
        <tbody>
          {res.map(({ p }) => (
            <tr key={p.id} onClick={() => onLoadPatient(p)} style={{ cursor: 'pointer' }}>
              <td>#{p.id + 1}</td>
              <td>{p.inputs.sex_male ? 'M' : 'F'}, {p.inputs.age}</td>
              <td>{p.inputs.typical_cp ? 'typical' : p.inputs.atypical ? 'atypical' : p.inputs.nonanginal ? 'non-anginal' : 'none'}</td>
              <td className="r">{p.inputs.ef}%</td>
              <td className="r">{p.inputs.rwma}</td>
              <td>{p.inputs.dm ? 'DM' : '–'} / {p.inputs.htn ? 'HTN' : '–'}</td>
              {TARGETS.map((t) => <td key={t}><span className={`pill ${p.labels[t] ? 'pos' : 'neg'}`}>{p.labels[t] ? (t === 'CAD' ? 'yes' : 'sten.') : 'no'}</span></td>)}
              <td className="r">{pct(p.oof.CAD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/* ------------------------------------------------------------------ evidence */
export function Evidence({ card }: { card: ModelCard }) {
  const t = card.targets
  const ser = (fn: (id: TargetId) => [number, number][], meta?: (id: TargetId) => string[]) =>
    TARGETS.map((id) => ({ id, label: id, color: SERIES_COLORS[id], pts: fn(id), meta: meta?.(id) }))
  return (
    <>
      <table className="data" style={{ marginBottom: 16 }}>
        <thead>
          <tr><th>Target</th><th>Model</th><th className="r">ROC-AUC</th><th className="r">PR-AUC</th><th className="r">Accuracy</th><th className="r">Precision</th><th className="r">Recall</th><th className="r">Specificity</th><th className="r">F1</th><th className="r">Brier</th><th className="r">Conformal coverage</th></tr>
        </thead>
        <tbody>
          {TARGETS.map((id) => {
            const m = t[id].metrics
            const f = (k: string, d = 3) => `${m[k][0].toFixed(d)} ± ${m[k][1].toFixed(d)}`
            return (
              <tr key={id}>
                <td><b>{id}</b></td><td>{t[id].model_label}</td>
                <td className="r">{f('auc')}</td><td className="r">{f('pr_auc')}</td><td className="r">{f('accuracy')}</td>
                <td className="r">{f('precision')}</td><td className="r">{f('recall')}</td><td className="r">{f('specificity')}</td>
                <td className="r">{f('f1')}</td><td className="r">{f('brier')}</td>
                <td className="r">{pct(t[id].conformal.coverage, 1)} <span style={{ color: 'var(--muted)' }}>(target {pct(1 - card.alpha)})</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint">Mean ± SD over {card.targets.CAD.n_folds} outer folds of repeated, nested, stratified cross-validation (5 folds × {card.targets.CAD.n_folds / 5} repeats). Hyper-parameters, calibration, thresholds and conformal quantiles were all fit inside each training fold, and LAD, LCX, RCA and Cath were never inputs.</p>
      <div className="evidence-grid">
        <figure>
          <figcaption>ROC curves<small>Pooled out-of-fold predictions</small></figcaption>
          <LineChart ariaLabel="ROC curves" diagonal x={[0, 1]} y={[0, 1]} xLabel="False positive rate" yLabel="True positive rate"
            series={ser((id) => t[id].roc.map((r: number[]) => [r[0], r[1]]))} />
        </figure>
        <figure>
          <figcaption>Calibration<small>Predicted vs observed rate, decile bins</small></figcaption>
          <LineChart ariaLabel="Calibration curves" diagonal x={[0, 1]} y={[0, 1]} xLabel="Predicted probability" yLabel="Observed rate"
            series={ser((id) => t[id].calibration.map((r: number[]) => [r[0], r[1]]), (id) => t[id].calibration.map((r: number[]) => `(n=${r[2]})`))} />
        </figure>
        <figure>
          <figcaption>Decision curve, CAD<small>Net benefit vs treat-all and treat-none</small></figcaption>
          <LineChart ariaLabel="Decision curve analysis" x={[0, 0.8]} y={[-0.1, 0.7]} xLabel="Threshold probability" yLabel="Net benefit"
            series={[
              { id: 'model', label: 'Model', color: SERIES_COLORS.CAD, pts: t.CAD.dca.filter((r: number[]) => r[0] <= 0.8).map((r: number[]) => [r[0], r[1]]) },
              { id: 'all', label: 'Treat all', color: '#8a969e', dash: '4 3', pts: t.CAD.dca.filter((r: number[]) => r[0] <= 0.8).map((r: number[]) => [r[0], r[2]]) },
              { id: 'none', label: 'Treat none', color: '#c3ccd0', dash: '1 3', pts: t.CAD.dca.filter((r: number[]) => r[0] <= 0.8).map((r: number[]) => [r[0], 0]) },
            ]} />
        </figure>
      </div>
      <h3 style={{ marginTop: 18 }}>Algorithm comparison (nested CV, ROC-AUC)</h3>
      <p className="hint">Single algorithms predict each target directly. The last two rows are the full calibrated pipeline with direct vessel models versus the deployed hierarchical structure. On identical splits the hierarchical version matches discrimination, improves the Brier score for all three vessels, and removes {card.sanity.direct_violations ?? 'all'} cases where a direct model gave a vessel a higher probability than CAD itself.</p>
      <table className="data">
        <thead><tr><th>Algorithm</th>{TARGETS.map((id) => <th key={id} className="r">{id}</th>)}</tr></thead>
        <tbody>
          {Object.keys(card.comparison.CAD.reduce((a, r) => ({ ...a, [r.model]: 1 }), {} as Record<string, number>)).map((name) => (
            <tr key={name} className={name.includes('deployed') ? 'best' : undefined}>
              <td>{ALGO[name] ?? name}</td>
              {TARGETS.map((id) => {
                const r = card.comparison[id].find((x) => x.model === name)
                const best = r && Math.max(...card.comparison[id].map((x) => x.auc[0])) === r.auc[0]
                return <td key={id} className="r" style={best ? { fontWeight: 700 } : undefined}>{r ? `${r.auc[0].toFixed(3)} ± ${r.auc[1].toFixed(3)}` : '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 18 }}>Subgroups (ROC-AUC, out-of-fold)</h3>
      <table className="data">
        <thead><tr><th>Group</th><th className="r">n</th>{TARGETS.map((id) => <th key={id} className="r">{id}</th>)}</tr></thead>
        <tbody>
          {Object.entries(card.subgroups ?? {}).map(([g, r]: [string, any]) => (
            <tr key={g}><td>{g}</td><td className="r">{r.n}</td>{TARGETS.map((id) => <td key={id} className="r">{r[id] == null ? '—' : r[id].toFixed(3)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Vessel-level discrimination is noticeably lower in patients aged 60 or over and in diabetics, where diffuse multi-vessel disease is common. Use it with extra caution there.</p>
      <h3 style={{ marginTop: 18 }}>Sanity checks</h3>
      <table className="data">
        <tbody>
          {card.sanity.rows.map((r: [string, string, string]) => (
            <tr key={r[0]}><td style={{ width: '38%' }}>{r[0]}</td><td><b>{r[1]}</b></td><td style={{ color: 'var(--muted)' }}>{r[2]}</td></tr>
          ))}
          {card.shap_check && (
            <>
              <tr><td>CAD attributions vs shap.LinearExplainer</td><td><b>max |Δ| {card.shap_check.CAD_linear_max_abs_diff.toExponential(0)}</b></td><td style={{ color: 'var(--muted)' }}>identical: exact interventional SHAP</td></tr>
              <tr><td>Vessel attributions vs shap.KernelExplainer</td><td><b>r = {(['LAD', 'LCX', 'RCA'].map((v) => card.shap_check[v].pearson_r_mean).reduce((a: number, b: number) => a + b, 0) / 3).toFixed(2)}</b></td><td style={{ color: 'var(--muted)' }}>mean correlation; top-5 features overlap {(['LAD', 'LCX', 'RCA'].map((v) => card.shap_check[v].top5_overlap_mean).reduce((a: number, b: number) => a + b, 0) / 3 * 100).toFixed(0)}%</td></tr>
            </>
          )}
        </tbody>
      </table>
    </>
  )
}
