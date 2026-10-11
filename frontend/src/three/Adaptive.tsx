import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'

/** Adaptive quality for machines without a dedicated GPU.
 *
 *  drei's PerformanceMonitor watches the real frame rate. When it falls below the display's comfortable
 *  range the scene steps down: tier 2 (full) -> 1 (lower render resolution, no flow particles)
 *  -> 0 (lowest resolution, heartbeat animation paused). It steps back up when frames recover.
 *  `?quality=full|low` in the URL pins a tier (used for benchmarking); `?fps=1` shows a live counter.
 */
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
const PIN = params.get('quality')
export const SHOW_FPS = params.get('fps') === '1'

export function useAdaptiveQuality() {
  const pinned = PIN === 'full' ? 2 : PIN === 'low' ? 0 : null
  const [tier, setTier] = useState<number>(pinned ?? 2)
  const [dpr, setDpr] = useState<number>(pinned === 0 ? 0.75 : Math.min(1.75, window.devicePixelRatio || 1))
  const monitor = pinned != null ? null : (
    <PerformanceMonitor
      flipflops={4}
      onChange={({ factor }) => setDpr(Math.round((0.75 + factor * (Math.min(1.75, window.devicePixelRatio || 1) - 0.75)) * 20) / 20)}
      onDecline={() => setTier((t) => Math.max(0, t - 1))}
      onIncline={() => setTier((t) => Math.min(2, t + 1))}
      onFallback={() => { setTier(0); setDpr(0.75) }}
    />
  )
  return { tier, dpr, monitor }
}

/** Counts rendered frames and reports frames-per-second once a second (also on window.__clFps). */
export function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ n: 0, t: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    a.n += 1; a.t += dt
    if (a.t >= 1) {
      const fps = a.n / a.t
      ;(window as any).__clFps = [...((window as any).__clFps ?? []), fps].slice(-60)
      onFps?.(fps)
      a.n = 0; a.t = 0
    }
  })
  return null
}

export function QualityBadge({ tier, fps }: { tier: number; fps: number | null }) {
  if (!SHOW_FPS && tier === 2) return null
  return (
    <div className="quality-badge" title="Adaptive quality: the 3D view lowers its resolution and pauses decorative animation when the frame rate drops, so it stays smooth without a dedicated GPU.">
      {tier < 2 && <span>Adaptive quality: {tier === 1 ? 'reduced' : 'low'}</span>}
      {SHOW_FPS && fps != null && <b>{fps.toFixed(0)} fps</b>}
    </div>
  )
}
