import { useMemo, useState } from 'react'
import { useApp } from '../lib/ctx'
import { predictLocal } from '../lib/engine'
import { pct, riskBand, riskHex } from '../lib/risk'
import { PatientPanel } from '../components/PatientPanel'
import { Term } from '../components/Term'
import type { FeatureSpec, Inputs } from '../lib/types'

interface Persona { id: string; title: string; who: string; detail: string; inputs: Inputs; truth?: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function describe(x: Inputs): string {
  const bits: string[] = []
  if (Number(x.typical_cp)) bits.push('typical chest pain')
  else if (Number(x.atypical)) bits.push('atypical chest pain')
  else if (Number(x.nonanginal)) bits.push('non-cardiac-type chest pain')
  else bits.push('no chest pain')
  if (Number(x.dm)) bits.push('diabetic')
  if (Number(x.htn)) bits.push('high blood pressure')
  if (Number(x.current_smoker)) bits.push('smoker')
  if (Number(x.q_wave)) bits.push('Q waves on ECG')
  if (Number(x.rwma)) bits.push('weak wall motion')
  return bits.slice(0, 4).join(', ')
}

export function StepPatient({ onNext }: { onNext: () => void }) {
  const app = useApp()
  const { data, inputs, load, onChange, source, pred } = app
  const [all, setAll] = useState(false)

  const personas: Persona[] = useMemo(() => {
    const list: Persona[] = data.presets.filter((p) => p.id !== 'median').map((p) => ({
      id: `preset:${p.id}`, title: cap(p.label.split(',').slice(1).join(',').trim() || p.label),
      who: `${Number(p.inputs.sex_male) ? 'Man' : 'Woman'}, ${p.inputs.age}`, detail: describe(p.inputs), inputs: p.inputs,
    }))
    const pick = (fn: (p: (typeof data.patients)[number]) => boolean, title: string) => {
      const p = data.patients.find(fn)
      if (p) list.push({ id: `dataset:${p.id}`, title, who: `${Number(p.inputs.sex_male) ? 'Man' : 'Woman'}, ${p.inputs.age} · real case #${p.id + 1}`,
        detail: describe(p.inputs), inputs: p.inputs,
        truth: `Angiography: ${p.labels.CAD ? ['LAD', 'LCX', 'RCA'].filter((v) => p.labels[v as 'LAD']).join(', ') + ' narrowed' : 'no significant narrowing'}` })
    }
    pick((p) => p.labels.LAD === 1 && p.labels.LCX === 1 && p.labels.RCA === 1 && p.oof.CAD > 0.95, 'Three-vessel disease')
    pick((p) => p.labels.CAD === 0 && Number(p.inputs.typical_cp) === 1 && p.oof.CAD < 0.5, 'Chest pain, clear arteries')
    pick((p) => p.labels.CAD === 1 && p.labels.LAD === 1 && p.labels.LCX === 0 && p.labels.RCA === 0 && p.oof.LAD > 0.6, 'Front artery (LAD) only')
    pick((p) => p.labels.CAD === 1 && p.labels.LAD === 0 && p.labels.LCX === 0 && p.labels.RCA === 1, 'Right artery only')
    return list
  }, [data])

  const scored = useMemo(() => personas.map((p) => predictLocal(data.bundle, p.inputs).targets.CAD.p), [personas, data.bundle])
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])
  const cad = pred?.targets.CAD

  const pain = Number(inputs.typical_cp) ? 'typical' : Number(inputs.atypical) ? 'atypical' : Number(inputs.nonanginal) ? 'nonanginal' : 'none'
  const setPain = (v: string) => {
    onChange('typical_cp', v === 'typical' ? 1 : 0)
    onChange('atypical', v === 'atypical' ? 1 : 0)
    onChange('nonanginal', v === 'nonanginal' ? 1 : 0)
  }

  return (
    <div className="page">
      <section className="page-head">
        <h2>Who are we looking at?</h2>
        <p>Pick an example patient, or describe your own with the questions below. Everything updates as you go, and you can change any answer later.</p>
      </section>

      <section className="personas" aria-label="Example patients">
        {personas.map((p, i) => {
          const active = source === p.id
          return (
            <button key={p.id} className={`persona ${active ? 'is-on' : ''}`} onClick={() => load(p.inputs, p.id)} aria-pressed={active}>
              <span className="persona-av" style={{ background: riskHex(scored[i]) }}>{p.who.slice(0, 1)}</span>
              <span className="persona-body">
                <b>{p.title}</b>
                <small>{p.who}</small>
                <span className="persona-detail">{p.detail}</span>
                {p.truth && <span className="persona-truth">{p.truth}</span>}
              </span>
              <span className="persona-risk" style={{ color: riskHex(scored[i]) }}>{pct(scored[i])}<small>CAD risk</small></span>
            </button>
          )
        })}
      </section>

      <section className="qc" aria-label="Quick check">
        <div className="qc-head">
          <h3>Quick check</h3>
          <p>The answers that matter most to the model. <button className="linkbtn" onClick={() => setAll(true)}>Edit all 54 measurements</button></p>
        </div>
        <div className="qc-grid">
          <fieldset className="qc-card">
            <legend>About the person</legend>
            <Slider f={feats.age} v={inputs.age} on={onChange} />
            <Seg label={<Term k="sex_male">Sex</Term>} value={Number(inputs.sex_male)} options={[[0, 'Female'], [1, 'Male']]} on={(v) => onChange('sex_male', v)} />
            <Slider f={feats.height} v={inputs.height} on={onChange} />
            <Slider f={feats.weight} v={inputs.weight} on={onChange} />
            <div className="qc-note"><Term k="bmi">BMI</Term> {Number(inputs.bmi).toFixed(1)} (calculated from height and weight)</div>
          </fieldset>

          <fieldset className="qc-card">
            <legend>Symptoms</legend>
            <div className="qc-label">Chest pain</div>
            <div className="pain">
              {([['typical', 'Typical angina', 'Pressure on exertion, eases with rest'], ['atypical', 'Atypical', 'Some features of angina'],
                ['nonanginal', 'Non-anginal', 'Unlikely to be from the heart'], ['none', 'None', 'No chest pain']] as const).map(([k, l, d]) => (
                <button key={k} className="pain-opt" aria-pressed={pain === k} onClick={() => setPain(k)}><b>{k === 'none' ? l : <Term k={k === 'typical' ? 'typical_cp' : k}>{l}</Term>}</b><small>{d}</small></button>
              ))}
            </div>
            <Chips items={[['dyspnea', 'Short of breath'], ['edema', 'Swollen ankles']]} inputs={inputs} on={onChange} />
            <Slider f={feats.bp} v={inputs.bp} on={onChange} label="Blood pressure (top number)" />
            <Slider f={feats.pr} v={inputs.pr} on={onChange} label="Pulse" />
          </fieldset>

          <fieldset className="qc-card">
            <legend>History</legend>
            <Chips items={[['dm', 'Diabetes'], ['htn', 'High blood pressure'], ['dlp', 'High cholesterol'], ['current_smoker', 'Smokes now'], ['ex_smoker', 'Used to smoke'], ['fh', 'Family history of heart disease']]} inputs={inputs} on={onChange} />
            <legend className="sub">Blood tests</legend>
            <Slider f={feats.ldl} v={inputs.ldl} on={onChange} label="LDL (“bad”) cholesterol" />
            <Slider f={feats.hdl} v={inputs.hdl} on={onChange} label="HDL (“good”) cholesterol" />
            <Slider f={feats.fbs} v={inputs.fbs} on={onChange} label="Fasting blood sugar" />
          </fieldset>

          <fieldset className="qc-card">
            <legend>Heart tests</legend>
            <div className="qc-label"><Term k="ECG">ECG findings</Term></div>
            <Chips items={[['q_wave', 'Q waves'], ['st_elevation', 'ST elevation'], ['st_depression', 'ST depression'], ['t_inversion', 'T-wave inversion'], ['lvh', 'Thick heart wall (LVH)']]} inputs={inputs} on={onChange} />
            <Slider f={feats.ef} v={inputs.ef} on={onChange} label="Ejection fraction (pumping strength)" />
            <Seg label={<Term k="rwma">Heart-wall areas moving poorly</Term>} value={Number(inputs.rwma)} options={[[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]} on={(v) => onChange('rwma', v)} />
          </fieldset>
        </div>
      </section>

      <div className="nextbar">
        {cad && (
          <div className="nextbar-res">
            <span className="dot" style={{ background: riskHex(cad.p) }} />
            Estimated chance of <Term k="CAD">coronary artery disease</Term>: <b style={{ color: riskHex(cad.p) }}>{pct(cad.p)}</b>
            <span className="muted">({riskBand(cad.p).label.toLowerCase()})</span>
          </div>
        )}
        <button className="btn primary big" onClick={onNext}>See the heart</button>
      </div>

      {all && (
        <div className="sheet" role="dialog" aria-label="All measurements">
          <div className="sheet-backdrop" onClick={() => setAll(false)} />
          <div className="sheet-panel">
            <div className="sheet-head"><h3>All 54 measurements</h3><button className="btn" onClick={() => setAll(false)}>Done</button></div>
            <PatientPanel features={data.features} inputs={inputs} baseline={app.baseline} onChange={onChange} onLoad={load}
              onReset={() => app.setInputs(() => app.baseline)} patients={data.patients} presets={data.presets} source={source} />
          </div>
        </div>
      )}
    </div>
  )
}

function Slider({ f, v, on, label }: { f: FeatureSpec; v: number | string; on: (k: string, v: number) => void; label?: React.ReactNode }) {
  const lo = f.minimum ?? 0, hi = f.maximum ?? 100, n = Number(v)
  const nr = f.normal
  const out = nr && (n < nr[0] || n > nr[1])
  return (
    <div className="qs">
      <div className="qs-top">
        <label htmlFor={`qs-${f.key}`}><Term k={f.key}>{label ?? f.label}</Term></label>
        <span className={`qs-val ${out ? 'out' : ''}`}>{f.step && f.step < 1 ? n.toFixed(1) : Math.round(n)} <small>{f.unit}</small></span>
      </div>
      <div className="range-wrap">
        {nr && <div className="normal" style={{ left: `${((Math.max(nr[0], lo) - lo) / (hi - lo)) * 100}%`, width: `${((Math.min(nr[1], hi) - Math.max(nr[0], lo)) / (hi - lo)) * 100}%` }} />}
        <input id={`qs-${f.key}`} type="range" min={lo} max={hi} step={f.step ?? 1} value={n} onChange={(e) => on(f.key, Number(e.target.value))} />
      </div>
    </div>
  )
}

function Seg({ label, value, options, on }: { label: React.ReactNode; value: number; options: [number, string][]; on: (v: number) => void }) {
  return (
    <div className="qs qs-seg">
      <div className="qs-top"><span>{label}</span></div>
      <div className="seg wide" role="group">
        {options.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => on(v)}>{l}</button>)}
      </div>
    </div>
  )
}

function Chips({ items, inputs, on }: { items: [string, string][]; inputs: Inputs; on: (k: string, v: number) => void }) {
  return (
    <div className="chiprow">
      {items.map(([k, l]) => (
        <button key={k} className="tchip" aria-pressed={Number(inputs[k]) === 1} onClick={() => on(k, Number(inputs[k]) ? 0 : 1)}>
          <span className="tick" aria-hidden>{Number(inputs[k]) ? '✓' : '+'}</span><Term k={k}>{l}</Term>
        </button>
      ))}
    </div>
  )
}
