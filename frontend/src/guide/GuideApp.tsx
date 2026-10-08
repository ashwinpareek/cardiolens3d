import { useEffect, useState } from 'react'
import { useApp } from '../lib/ctx'
import { StepPatient } from './StepPatient'
import { StepHeart } from './StepHeart'
import { StepWhy } from './StepWhy'
import { StepWhatIf } from './StepWhatIf'
import { StepReport } from './StepReport'
import { Evidence } from '../components/Drawer'
import { pct, riskHex } from '../lib/risk'

const STEPS = [
  { id: 'patient', label: 'Patient', hint: 'Choose or describe a patient' },
  { id: 'heart', label: 'Heart', hint: 'See the risk on a 3D heart' },
  { id: 'why', label: 'Why', hint: 'What drives the estimate' },
  { id: 'whatif', label: 'What if', hint: 'Try changing things' },
  { id: 'report', label: 'Report', hint: 'Download a summary' },
] as const
type StepId = (typeof STEPS)[number]['id']

export function GuideApp() {
  const app = useApp()
  const [step, setStep] = useState<StepId>(() => (STEPS.find((s) => `#${s.id}` === location.hash)?.id ?? 'patient'))
  const [evidence, setEvidence] = useState(false)
  const [help, setHelp] = useState(() => { try { return localStorage.getItem('cl-help-seen') !== '1' } catch { return true } })
  const idx = STEPS.findIndex((s) => s.id === step)
  const cad = app.pred?.targets.CAD

  useEffect(() => { try { history.replaceState(null, '', `#${step}`) } catch { /* sandboxed */ } window.scrollTo(0, 0) }, [step])
  const closeHelp = () => { setHelp(false); try { localStorage.setItem('cl-help-seen', '1') } catch { /* ignore */ } }

  return (
    <div className="guide">
      <header className="g-top">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 21s-7.5-4.6-9.3-9.6C1.4 7.7 3.8 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4c3.6 0 6 3.7 4.7 7.4C19.5 16.4 12 21 12 21z" fill="none" stroke="#15222c" strokeWidth="1.6" />
            <path d="M3 12h4l2-3 3 6 2-3h7" fill="none" stroke="#d43d3d" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <h1>CardioLens 3D</h1>
        </div>
        <nav className="stepper" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.id} className={`st ${i === idx ? 'is-on' : ''} ${i < idx ? 'is-done' : ''}`} onClick={() => setStep(s.id)} aria-current={i === idx ? 'step' : undefined} title={s.hint}>
              <span className="st-n">{i < idx ? '✓' : i + 1}</span>
              <span className="st-l">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="g-actions">
          {cad && step !== 'patient' && (
            <span className="g-pill" title="Current estimate of coronary artery disease">
              <span className="dot" style={{ background: riskHex(cad.p) }} />CAD {pct(cad.p)}
            </span>
          )}
          <button className="btn ghost" onClick={() => setHelp(true)} aria-label="How to use">Help</button>
          <button className="btn ghost" onClick={() => setEvidence(true)}>Model evidence</button>
          <button className="btn" onClick={() => app.setMode('expert')} title="All panels at once, for clinicians and judges">Expert view</button>
        </div>
      </header>
      <div className="g-disclaimer" role="note"><b>Education and decision support only.</b> Not a diagnosis. Only angiography or CT coronary angiography can show narrowed arteries.</div>

      <main className="g-main">
        {step === 'patient' && <StepPatient onNext={() => setStep('heart')} />}
        {step === 'heart' && <StepHeart onWhy={(t) => { app.setExplainTarget(t); setStep('why') }} />}
        {step === 'why' && <StepWhy />}
        {step === 'whatif' && <StepWhatIf />}
        {step === 'report' && <StepReport />}
      </main>

      {step !== 'patient' && (
        <footer className="g-foot">
          <button className="btn" onClick={() => setStep(STEPS[Math.max(0, idx - 1)].id)}>Back: {STEPS[Math.max(0, idx - 1)].label}</button>
          {idx < STEPS.length - 1 && <button className="btn primary" onClick={() => setStep(STEPS[idx + 1].id)}>Next: {STEPS[idx + 1].label}</button>}
        </footer>
      )}

      {evidence && (
        <div className="sheet" role="dialog" aria-label="Model evidence">
          <div className="sheet-backdrop" onClick={() => setEvidence(false)} />
          <div className="sheet-panel wide">
            <div className="sheet-head"><h3>How well does the model work?</h3><button className="btn" onClick={() => setEvidence(false)}>Close</button></div>
            <div className="sheet-body"><Evidence card={app.data.card} /></div>
          </div>
        </div>
      )}

      {help && (
        <div className="sheet center" role="dialog" aria-label="How to use CardioLens">
          <div className="sheet-backdrop" onClick={closeHelp} />
          <div className="help-card">
            <h2>Welcome to CardioLens 3D</h2>
            <p>This tool estimates how likely someone is to have narrowed heart arteries, using routine check-up information, and shows the answer on a 3D heart.</p>
            <ol className="help-steps">
              <li><b>Patient.</b> Pick an example or answer a few questions.</li>
              <li><b>Heart.</b> Press <i>Explain this heart</i> for a guided tour, or drag to rotate and tap an artery.</li>
              <li><b>Why.</b> See which answers push the risk up or down.</li>
              <li><b>What if.</b> Change blood pressure, cholesterol or smoking and watch it update.</li>
              <li><b>Report.</b> Download a PDF to keep or share.</li>
            </ol>
            <p className="muted small">Underlined words have a plain-English explanation; hover or tap them.</p>
            <button className="btn primary big" onClick={closeHelp}>Get started</button>
          </div>
        </div>
      )}
    </div>
  )
}
