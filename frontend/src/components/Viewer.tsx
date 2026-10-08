import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr } from '@react-three/drei'
import { HeartScene, AnatomyPart, ViewMode } from '../three/HeartScene'
import type { Centerlines } from '../three/FlowParticles'
import { riskGradientCss } from '../lib/risk'
import type { VesselId } from '../lib/types'

interface Props {
  risks: Record<VesselId, number>
  uncertain: Record<VesselId, boolean>
  selected: VesselId | null
  onSelect: (v: VesselId | null) => void
  bpm: number
  registry: AnatomyPart[]
  centerlines: Centerlines | null
  base: string
}

export function Viewer(p: Props) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [view, setView] = useState<ViewMode>('heart')
  const [layers, setLayers] = useState({ territory: true, flow: true, labels: true, beating: true })
  const [lift, setLift] = useState(0)
  const [cut, setCut] = useState(0)
  const [angio, setAngio] = useState(false)
  // showcase turntable: the heart turns slowly on load and stops the moment anyone touches it
  const [spin, setSpin] = useState(!reduced)
  const toggle = (k: keyof typeof layers) => setLayers((s) => ({ ...s, [k]: !s[k] }))
  const stop = () => spin && setSpin(false)

  return (
    <div className={`lightbox ${angio ? 'is-angio' : ''}`} onPointerDown={stop} onWheel={stop}>
      <Canvas
        camera={{ position: [1.25, 0.45, 2.75], fov: 35, near: 0.05, far: 60 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true }}
        frameloop="always"
      >
        <AdaptiveDpr pixelated={false} />
        <Suspense fallback={null}>
          <HeartScene
            {...p}
            view={view}
            territory={layers.territory}
            flow={layers.flow && !reduced}
            labels={layers.labels}
            beating={layers.beating && !reduced}
            lift={lift} cut={cut} angio={angio}
            autoRotate={spin}
          />
        </Suspense>
      </Canvas>

      <div className="overlay-top">
        <div className="toolbar" role="group" aria-label="View">
          <button aria-pressed={view === 'heart' && !angio} onClick={() => { setView('heart'); setAngio(false) }}>Heart</button>
          <button aria-pressed={view === 'torso'} onClick={() => { setView('torso'); setAngio(false); setCut(0) }}>Thorax</button>
          <button aria-pressed={angio} onClick={() => { setAngio(!angio); setView('heart') }} title="Simulated angiogram look">X-ray</button>
        </div>
        <div className="toolbar" role="group" aria-label="Anatomy">
          <button aria-pressed={lift > 0} onClick={() => setLift(lift > 0 ? 0 : 1)} title="Exploded view: lift the coronary tree off the surface">Lift arteries</button>
          <button aria-pressed={cut > 0} onClick={() => { setCut(cut > 0 ? 0 : 0.75); setView('heart') }} title="Cut away the front wall to show the chambers">Cut open</button>
          <button aria-pressed={spin} onClick={() => setSpin(!spin)} title="Turntable rotation">Spin</button>
        </div>
        <div className="toolbar" role="group" aria-label="Layers">
          <button aria-pressed={layers.territory} onClick={() => toggle('territory')}>Territories</button>
          <button aria-pressed={layers.flow} onClick={() => toggle('flow')}>Flow</button>
          <button aria-pressed={layers.labels} onClick={() => toggle('labels')}>Labels</button>
          <button aria-pressed={layers.beating} onClick={() => toggle('beating')}>Beat</button>
        </div>
        <div className="lb-note">Drag to rotate, scroll to zoom, click an artery to inspect it. Colour is a whole-vessel probability: the dataset does not record where along a vessel a lesion sits.</div>
      </div>

      <div className="legend" aria-hidden>
        Predicted stenosis probability
        <div className="bar" style={{ background: riskGradientCss }} />
        <div className="ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      </div>
      <div className="vitals" aria-label="Heart rate">
        <strong><span className="beat">♥</span> {Math.round(p.bpm)}</strong>
        bpm, from the pulse-rate input
      </div>
    </div>
  )
}
