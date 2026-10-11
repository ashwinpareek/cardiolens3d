import { useMemo, useState } from 'react'
import { NoteImport } from './NoteImport'
import type { DatasetPatient, FeatureSpec, Inputs } from '../lib/types'

const GROUP_ORDER = ['Demographics', 'History', 'Symptoms & Exam', 'ECG', 'Laboratory', 'Echocardiography']

export interface Preset { id: string; label: string; inputs: Inputs }

interface Props {
  features: FeatureSpec[]
  inputs: Inputs
  baseline: Inputs
  onChange: (key: string, v: number | string) => void
  onLoad: (inputs: Inputs, source: string) => void
  onReset: () => void
  patients: DatasetPatient[]
  presets: Preset[]
  source: string
}

function fmt(v: number, step: number | null) {
  if (step && step < 1) return v.toFixed(step < 0.1 ? 2 : 1)
  return String(Math.round(v))
}

export function PatientPanel({ features, inputs, baseline, onChange, onLoad, onReset, patients, presets, source }: Props) {
  const [note, setNote] = useState(false)
  const groups = useMemo(() => {
    const g: Record<string, FeatureSpec[]> = {}
    for (const f of features) (g[f.group] ??= []).push(f)
    return GROUP_ORDER.filter((k) => g[k]).map((k) => [k, g[k]] as const)
  }, [features])

  const changed = (k: string) => String(inputs[k]) !== String(baseline[k])
  const nChanged = features.filter((f) => changed(f.key)).length
  const dsId = source.startsWith('dataset:') ? Number(source.slice(8)) : null
  const ds = dsId != null ? patients.find((p) => p.id === dsId) : null

  return (
    <aside className="rail rail-left" aria-label="Patient inputs">
      <div className="section">
        <h2>Patient</h2>
        <p className="hint">Load a case from the dataset or a preset, then edit any value. Every edit re-scores the patient and updates the heart.</p>
        <div className="select-row">
          <select
            aria-label="Dataset patient"
            value={dsId ?? ''}
            onChange={(e) => {
              const p = patients.find((x) => x.id === Number(e.target.value))
              if (p) onLoad(p.inputs, `dataset:${p.id}`)
            }}
          >
            <option value="" disabled>Dataset patient…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id + 1} · {p.inputs.sex_male ? 'M' : 'F'} {p.inputs.age} · {p.labels.CAD ? 'CAD' : 'normal'}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => {
            const p = patients[Math.floor(Math.random() * patients.length)]
            onLoad(p.inputs, `dataset:${p.id}`)
          }}>Random</button>
        </div>
        <button className="btn note-btn" onClick={() => setNote(true)} title="Fill the inputs from a pasted referral letter or lab report">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.5h5.5L11 4v8.5H3z M8.5 1.5V4H11 M5 7h4 M5 9.5h4" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          Import from clinical note
        </button>
        {note && <NoteImport onClose={() => setNote(false)} />}
        <div className="chips" role="group" aria-label="Presets">
          {presets.map((p) => (
            <button key={p.id} className="chip" aria-pressed={source === `preset:${p.id}`} onClick={() => onLoad(p.inputs, `preset:${p.id}`)}>
              {p.label}
            </button>
          ))}
        </div>
        {ds && (
          <div className="truth" aria-label="Angiography result">
            <span>Angiography result:</span>
            {(['CAD', 'LAD', 'LCX', 'RCA'] as const).map((t) => (
              <span key={t}><b>{t}</b> {ds.labels[t] ? (t === 'CAD' ? 'present' : 'stenotic') : (t === 'CAD' ? 'absent' : 'normal')}</span>
            ))}
          </div>
        )}
        <div className="select-row" style={{ marginTop: 12 }}>
          <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>
            {nChanged ? `${nChanged} value${nChanged > 1 ? 's' : ''} changed from the loaded case` : 'No edits yet'}
          </span>
          <button className="btn" style={{ marginLeft: 'auto' }} disabled={!nChanged} onClick={onReset}>Undo edits</button>
        </div>
      </div>

      {groups.map(([g, fs], i) => (
        <details key={g} className="group" open={i === 0 || i === 2}>
          <summary>
            <svg className="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 1l4 4-4 4" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
            {g}
            <span className="count">{fs.filter((f) => changed(f.key)).length ? `${fs.filter((f) => changed(f.key)).length} edited` : `${fs.length}`}</span>
          </summary>
          <div className="fields">
            {fs.map((f) => (
              <Field key={f.key} f={f} value={inputs[f.key]} base={baseline[f.key]} changed={changed(f.key)} onChange={(v) => onChange(f.key, v)} />
            ))}
          </div>
        </details>
      ))}
    </aside>
  )
}

function Field({ f, value, base, changed, onChange }: { f: FeatureSpec; value: number | string; base: number | string; changed: boolean; onChange: (v: number | string) => void }) {
  if (f.kind === 'binary' || f.kind === 'categorical' || (f.kind === 'ordinal' && (f.options?.length ?? 0) <= 5)) {
    return (
      <div className={`field ${changed ? 'changed' : ''}`} title={f.description || undefined}>
        <div className="field-top">
          <label>{f.label}</label>
          <div className="seg" role="group" aria-label={f.label}>
            {f.options!.map(([v, l]) => (
              <button key={String(v)} aria-pressed={String(value) === String(v)} onClick={() => onChange(v)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }
  const lo = f.minimum ?? 0, hi = f.maximum ?? 100
  const v = Number(value)
  const nr = f.normal
  const left = nr ? ((Math.max(nr[0], lo) - lo) / (hi - lo)) * 100 : 0
  const width = nr ? ((Math.min(nr[1], hi) - Math.max(nr[0], lo)) / (hi - lo)) * 100 : 0
  const d = v - Number(base)
  return (
    <div className={`field ${changed ? 'changed' : ''}`} title={f.description || undefined}>
      <div className="field-top">
        <label htmlFor={`f-${f.key}`}>{f.label}</label>
        {f.unit && <span className="unit">{f.unit}</span>}
        {changed && <span className="delta">{d > 0 ? '+' : ''}{fmt(d, f.step)}</span>}
        <input
          className="num" type="number" aria-label={`${f.label} value`} value={fmt(v, f.step)}
          min={lo} max={hi} step={f.step ?? 1}
          onChange={(e) => { const x = Number(e.target.value); if (!Number.isNaN(x)) onChange(x) }}
        />
      </div>
      <div className="range-wrap">
        {nr && <div className="normal" style={{ left: `${left}%`, width: `${width}%` }} title={`Reference range ${nr[0]}–${nr[1]} ${f.unit}`} />}
        <input id={`f-${f.key}`} type="range" min={lo} max={hi} step={f.step ?? 1} value={v} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  )
}
