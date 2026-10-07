import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PatientPanel, Preset } from './components/PatientPanel'
import { AssessmentPanel } from './components/AssessmentPanel'
import { Viewer } from './components/Viewer'
import { Drawer } from './components/Drawer'
import { Report, ReportData } from './components/Report'
import { predictLocal, Bundle } from './lib/engine'
import type { DatasetPatient, FeatureSpec, Inputs, ModelCard, Prediction, TargetId, VesselId } from './lib/types'
import type { AnatomyPart } from './three/HeartScene'
import type { Centerlines } from './three/FlowParticles'

const BASE = import.meta.env.BASE_URL
// Static hosted demo (no model server, no print dialog): set VITE_STATIC_DEMO=1 at build time
const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === '1'

interface AppData {
  features: FeatureSpec[]
  patients: DatasetPatient[]
  presets: Preset[]
  card: ModelCard
  similar_weights: Record<string, number>
  bundle: Bundle
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [registry, setRegistry] = useState<AnatomyPart[]>([])
  const [centerlines, setCenterlines] = useState<Centerlines | null>(null)
  const [server, setServer] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [inputs, setInputs] = useState<Inputs>({})
  const [baseline, setBaseline] = useState<Inputs>({})
  const [source, setSource] = useState('')
  const [pred, setPred] = useState<Prediction | null>(null)
  const [selected, setSelected] = useState<VesselId | null>(null)
  const [explainTarget, setExplainTarget] = useState<TargetId>('CAD')
  const [report, setReport] = useState<ReportData | null>(null)

  // ---------------------------------------------------------------- load
  useEffect(() => {
    ;(async () => {
      try {
        const [d, reg, cl] = await Promise.all([
          getJSON<AppData>(`${BASE}data/app_data.json`),
          getJSON<{ parts: AnatomyPart[] }>(`${BASE}anatomy/registry.json`),
          getJSON<Centerlines>(`${BASE}anatomy/centerlines.json`),
        ])
        setData(d); setRegistry(reg.parts); setCenterlines(cl)
        const start = d.presets[1] ?? d.presets[0]
        setInputs(start.inputs); setBaseline(start.inputs); setSource(`preset:${start.id}`)
      } catch (e) {
        setError(String(e))
      }
      if (STATIC_DEMO) return
      try {
        const h = await fetch(`${BASE}api/health`, { signal: AbortSignal.timeout(1500) })
        setServer(h.ok && (await h.json()).status === 'ok')
      } catch { setServer(false) }
    })()
  }, [])

  // ---------------------------------------------------------------- score on every edit
  const reqId = useRef(0)
  useEffect(() => {
    if (!data || !Object.keys(inputs).length) return
    const id = ++reqId.current
    if (server) {
      const ctl = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const t1 = performance.now()
          const r = await fetch(`${BASE}api/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs }), signal: ctl.signal })
          if (!r.ok) throw new Error(await r.text())
          const j = await r.json()
          if (id === reqId.current) setPred({ ...j, engine: 'server', ms: performance.now() - t1 })
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            setServer(false) // fall back to the in-browser engine, same numbers
          }
        }
      }, 60)
      return () => { clearTimeout(timer); ctl.abort() }
    }
    const t0 = performance.now()
    const r = predictLocal(data.bundle, inputs)
    setPred({ ...r, engine: 'browser', ms: performance.now() - t0 })
  }, [inputs, data, server])

  const onChange = useCallback((key: string, v: number | string) => {
    setInputs((s) => {
      const n = { ...s, [key]: v }
      if (key === 'weight' || key === 'height') {
        const bmi = Number(n.weight) / (Number(n.height) / 100) ** 2
        n.bmi = Math.round(bmi * 10) / 10
      }
      if (key === 'weight' || key === 'height' || key === 'bmi') n.obesity = Number(n.bmi) > 25 ? 1 : 0
      return n
    })
  }, [])

  const load = useCallback((inp: Inputs, src: string) => {
    setInputs(inp); setBaseline(inp); setSource(src)
  }, [])

  const risks = useMemo(() => ({
    LAD: pred?.targets.LAD.p ?? 0, LCX: pred?.targets.LCX.p ?? 0, RCA: pred?.targets.RCA.p ?? 0,
  }), [pred])
  const uncertain = useMemo(() => ({
    LAD: (pred?.targets.LAD.set.length ?? 1) !== 1, LCX: (pred?.targets.LCX.set.length ?? 1) !== 1, RCA: (pred?.targets.RCA.set.length ?? 1) !== 1,
  }), [pred])

  const exportReport = () => {
    const c = document.querySelector('.lightbox canvas') as HTMLCanvasElement | null
    const src = source.startsWith('dataset:') ? `Dataset patient #${Number(source.slice(8)) + 1}` : source.startsWith('preset:') ? `Preset: ${data?.presets.find((p) => `preset:${p.id}` === source)?.label}` : 'Custom patient'
    setReport({ img: c?.toDataURL('image/png') ?? '', when: new Date().toLocaleString(), source: src + (JSON.stringify(inputs) !== JSON.stringify(baseline) ? ' (edited)' : '') })
    setTimeout(() => window.print(), 150)
  }

  if (error) return <div className="loading" style={{ color: 'var(--ink)' }}>Could not load the model data ({error}). Run <code>python ml/train_final.py</code> to generate it.</div>
  if (!data) return <div className="loading" style={{ color: 'var(--ink)', position: 'fixed' }}>Loading model and anatomy…</div>

  return (
    <>
    <Report data={report} pred={pred} features={data.features} inputs={inputs} alpha={data.card.alpha} card={data.card} />
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 21s-7.5-4.6-9.3-9.6C1.4 7.7 3.8 4 7.4 4c2 0 3.4 1.1 4.6 2.7C13.2 5.1 14.6 4 16.6 4c3.6 0 6 3.7 4.7 7.4C19.5 16.4 12 21 12 21z" fill="none" stroke="#15222c" strokeWidth="1.6" />
            <path d="M3 12h4l2-3 3 6 2-3h7" fill="none" stroke="#d43d3d" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <h1>CardioLens 3D</h1>
          <small>Coronary risk mapped onto anatomy</small>
        </div>
        <div className="disclaimer" role="note">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 1.5l7 12.5H1z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 6v4M8 11.6v.4" stroke="currentColor" strokeWidth="1.6" /></svg>
          <span><b>Decision support and education only.</b> Not a diagnosis and not a substitute for angiography, CT coronary angiography or a clinician's judgement.</span>
        </div>
        {!STATIC_DEMO && <button className="btn" onClick={exportReport} title="Print or save a one-page PDF summary">Export report</button>}
        <div className="engine" title={server ? 'Predictions computed by the FastAPI model server' : 'No server reachable: predictions computed in this browser from the same exported model'}>
          Model: <b>{server ? 'server' : 'in-browser'}</b>{pred ? ` · ${pred.ms.toFixed(pred.ms < 10 ? 1 : 0)} ms` : ''}
        </div>
      </header>

      <div className="workspace">
        <PatientPanel features={data.features} inputs={inputs} baseline={baseline} onChange={onChange} onLoad={load}
          onReset={() => setInputs(baseline)} patients={data.patients} presets={data.presets} source={source} />

        <main className="centre">
          <Viewer risks={risks} uncertain={uncertain} selected={selected}
            onSelect={(v) => { setSelected(v); setExplainTarget(v ?? 'CAD') }}
            bpm={Number(inputs.pr ?? 72)} registry={registry} centerlines={centerlines} base={BASE} />
          <Drawer pred={pred} card={data.card} features={data.features} inputs={inputs} patients={data.patients}
            explainTarget={explainTarget} onLoadPatient={(p) => load(p.inputs, `dataset:${p.id}`)} similarWeights={data.similar_weights} />
        </main>

        <AssessmentPanel pred={pred} features={data.features} inputs={inputs} selected={selected} onSelect={setSelected}
          explainTarget={explainTarget} onExplainTarget={setExplainTarget} alpha={data.card.alpha}
          bundle={data.bundle} onApply={(patch) => setInputs((s) => ({ ...s, ...patch }))} />
      </div>
    </div>
    </>
  )
}
