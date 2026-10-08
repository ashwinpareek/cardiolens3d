import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr } from '@react-three/drei'
import { HeartScene, FocusId } from '../three/HeartScene'
import { EcgStrip } from '../components/EcgStrip'
import { Term } from '../components/Term'
import { useApp } from '../lib/ctx'
import { pct, riskGradientCss } from '../lib/risk'
import { rank } from '../lib/format'
import type { VesselId } from '../lib/types'

const STOP_MS = 9000

const VESSEL_TEXT: Record<VesselId, { name: string; feeds: string }> = {
  LAD: { name: 'Left anterior descending (LAD)', feeds: 'the front wall of the heart and most of the wall between the two ventricles' },
  LCX: { name: 'Left circumflex (LCX)', feeds: 'the side and back wall of the left ventricle' },
  RCA: { name: 'Right coronary artery (RCA)', feeds: 'the right ventricle and, in most people, the bottom wall of the heart' },
}

interface TourStop { focus: FocusId; select: VesselId | null; title: string; body: string; view: 'heart' | 'torso'; cut?: number; lift?: number }

export function HeartStage({ compact = false }: { compact?: boolean }) {
  const app = useApp()
  const { pred, risks, uncertain, selected, setSelected, inputs, registry, centerlines, base, data } = app
  const [view, setView] = useState<'heart' | 'torso'>('heart')
  const [cut, setCut] = useState(0)
  const [lift, setLift] = useState(0)
  const [angio, setAngio] = useState(false)
  const [layers, setLayers] = useState({ territory: true, flow: true, labels: true, beating: true, ecg: false })
  const [tour, setTour] = useState<number | null>(null)
  const [playing, setPlaying] = useState(true)
  const [hovering, setHovering] = useState(false)
  const [progress, setProgress] = useState(0)   // 0..1 through the current stop, drives the sliding bar
  const [focus, setFocus] = useState<{ id: FocusId; key: number } | null>(null)
  // on wide screens the tour caption sits on the right and the heart slides left to stay fully visible
  const [wide, setWide] = useState(() => window.innerWidth > 1000)
  useEffect(() => { const f = () => setWide(window.innerWidth > 1000); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const feats = useMemo(() => Object.fromEntries(data.features.map((f) => [f.key, f])), [data.features])

  // ---- guided tour, written from the current prediction
  const stops: TourStop[] = useMemo(() => {
    if (!pred) return []
    const why = (t: VesselId | 'CAD') => rank(pred.attributions[t], feats).filter((r) => r.c > 0.03).slice(0, 2).map((r) => r.f.label.toLowerCase())
    const v = (id: VesselId): TourStop => {
      const p = pred.targets[id].p
      const unsure = pred.targets[id].set.length !== 1
      const w = why(id)
      return {
        focus: id, select: id, view: 'heart',
        title: `${VESSEL_TEXT[id].name}: ${pct(p)}`,
        body: `This artery feeds ${VESSEL_TEXT[id].feeds}. ${unsure ? 'The model is not confident either way for this one.' : p >= pred.targets[id].threshold ? 'The model thinks it is likely narrowed.' : 'The model thinks it is probably clear.'}${w.length ? ` Main reasons: ${w.join(' and ')}.` : ''}`,
      }
    }
    return [
      { focus: 'overview', select: null, view: 'heart', title: 'This is the patient’s heart, coloured by risk',
        body: `A real anatomical model. Each coronary artery is coloured by how likely it is to be narrowed: teal is low, red is high. Overall chance of coronary artery disease: ${pct(pred.targets.CAD.p)}.` },
      v('LAD'), v('LCX'), v('RCA'),
      { focus: 'LAD', select: null, view: 'heart', lift: 1, title: 'The arteries, lifted off the surface',
        body: 'Here the arteries are pulled away from the muscle so you can see the whole tree. The tint left on the muscle shows the area each artery feeds.' },
      { focus: 'overview', select: null, view: 'heart', cut: 0.75, title: 'Inside the heart',
        body: 'Cutting the front away shows the chambers. The arteries sit on the outside surface; narrowing there starves the muscle beneath.' },
      { focus: 'thorax', select: null, view: 'torso', title: 'Where it sits in the chest',
        body: 'The heart sits behind the breastbone, between the lungs. Use the tools below to explore on your own.' },
    ]
  }, [pred, feats])

  useEffect(() => {
    if (tour == null || !stops[tour]) return
    const s = stops[tour]
    setView(s.view); setSelected(s.select); setCut(s.cut ?? 0); setLift(s.lift ?? 0)
    setFocus((f) => ({ id: s.focus, key: (f?.key ?? 0) + 1 }))
    setProgress(0)
  }, [tour]) // eslint-disable-line react-hooks/exhaustive-deps

  // auto-advance: the current segment of the progress bar fills smoothly over STOP_MS, then the
  // card slides to the next stop. Pauses while the pointer is over the card or when paused.
  useEffect(() => {
    if (tour == null || !playing || hovering) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      const dt = now - last; last = now
      setProgress((p) => {
        const n = p + dt / STOP_MS
        if (n >= 1) {
          setTour((t) => (t != null && t < stops.length - 1 ? t + 1 : t))
          return tour < stops.length - 1 ? 0 : 1
        }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tour, playing, hovering, stops.length])

  const endTour = () => { setTour(null); setCut(0); setLift(0); setView('heart'); setFocus((f) => ({ id: 'overview', key: (f?.key ?? 0) + 1 })) }
  const bpm = Number(inputs.pr ?? 72)

  return (
    <div className={`stage ${angio ? 'is-angio' : ''} ${compact ? 'is-compact' : ''}`}>
      <Canvas camera={{ position: compact ? [1.6, 0.5, 3.2] : [1.25, 0.45, 2.75], fov: 35, near: 0.05, far: 60 }}
        dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true }}>
        <AdaptiveDpr pixelated={false} />
        <Suspense fallback={null}>
          <HeartScene risks={risks} uncertain={uncertain} selected={selected} onSelect={(v) => { setSelected(v); app.setExplainTarget(v ?? 'CAD') }}
            bpm={bpm} view={view} territory={layers.territory} flow={layers.flow && !reduced} labels={layers.labels}
            beating={layers.beating && !reduced} registry={registry} centerlines={centerlines} base={base}
            cut={cut} lift={lift} angio={angio} focus={focus?.id ?? null} focusKey={focus?.key} compact={compact}
            shift={tour != null && wide ? 0.1 : 0} />
        </Suspense>
      </Canvas>

      {!compact && (
        <>
          <div className="stage-top">
            {tour == null ? (
              <button className="tour-btn" onClick={() => { setPlaying(true); setTour(0) }}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 2l9 5-9 5z" fill="currentColor" /></svg>
                Explain this heart
              </button>
            ) : null}
            <div className="seg-dark" role="group" aria-label="View">
              <button aria-pressed={view === 'heart' && !angio} onClick={() => { setView('heart'); setAngio(false) }}>Heart</button>
              <button aria-pressed={view === 'torso'} onClick={() => { setView('torso'); setAngio(false); setCut(0) }}>In the body</button>
              <button aria-pressed={angio} onClick={() => { setAngio(!angio); setView('heart') }}><Term k="X-ray view">X-ray view</Term></button>
            </div>
          </div>

          {tour != null && stops[tour] && (
            <div className="tour-card" role="dialog" aria-label="Guided tour" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
              <div className="tour-prog" aria-label={`Stop ${tour + 1} of ${stops.length}`}>
                {stops.map((_, i) => (
                  <span key={i}><i style={{ width: `${i < tour ? 100 : i === tour ? progress * 100 : 0}%` }} /></span>
                ))}
              </div>
              <div className="tour-slide" key={tour}>
                <h3>{stops[tour].title}</h3>
                <p>{stops[tour].body}</p>
              </div>
              <div className="tour-nav">
                <button className="btn" disabled={tour === 0} onClick={() => setTour(tour - 1)}>Back</button>
                {tour < stops.length - 1
                  ? <button className="btn primary" onClick={() => setTour(tour + 1)}>Next</button>
                  : <button className="btn primary" onClick={endTour}>Explore myself</button>}
                <button className="btn" onClick={() => setPlaying(!playing)} aria-pressed={!playing}>{playing ? 'Pause' : 'Play'}</button>
                <button className="btn ghost" onClick={endTour}>End tour</button>
              </div>
            </div>
          )}

          <div className="dock" role="group" aria-label="3D tools" hidden={tour != null}>
            <label className="dock-slider">
              <span><Term k="cut open">Cut open</Term></span>
              <input type="range" min={0} max={1} step={0.01} value={cut} onChange={(e) => { setCut(+e.target.value); if (view !== 'heart') setView('heart') }} />
            </label>
            <label className="dock-slider">
              <span><Term k="lift arteries">Lift arteries</Term></span>
              <input type="range" min={0} max={1} step={0.01} value={lift} onChange={(e) => setLift(+e.target.value)} />
            </label>
            <span className="dock-sep" />
            {([['territory', 'Muscle tint', 'muscle tint'], ['flow', 'Blood flow', 'blood flow'], ['labels', 'Labels', ''], ['beating', 'Heartbeat', ''], ['ecg', 'ECG', 'ECG']] as const).map(([k, l, g]) => (
              <button key={k} className="dock-toggle" aria-pressed={layers[k]} onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}>{g ? <Term k={g}>{l}</Term> : l}</button>
            ))}
            <button className="dock-toggle" onClick={() => { setCut(0); setLift(0); setAngio(false); setView('heart'); setSelected(null); setFocus((f) => ({ id: 'overview', key: (f?.key ?? 0) + 1 })) }}>Reset view</button>
          </div>

          <div className="stage-legend" aria-hidden>
            <div className="bar" style={{ background: riskGradientCss }} />
            <div className="ticks"><span>Low</span><span>Chance of narrowing</span><span>High</span></div>
          </div>
          {layers.ecg && tour == null && <div className="stage-ecg"><EcgStrip inputs={inputs} bpm={bpm} playing={!reduced} /></div>}
          {angio && <div className="angio-note">Simulated angiogram: arteries are drawn dark, like dye on an X-ray. Their coloured glow still shows the model’s estimate. Not a real image.</div>}
        </>
      )}
    </div>
  )
}
