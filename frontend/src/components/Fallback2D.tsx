import { Component, type ReactNode } from 'react'
import { pct, riskHex } from '../lib/risk'
import type { VesselId } from '../lib/types'

/** Can this browser draw 3D? `?nowebgl=1` forces the fallback (used by the end-to-end test). */
export const WEBGL_OK: boolean = (() => {
  try {
    if (new URLSearchParams(window.location.search).get('nowebgl') === '1') return false
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch { return false }
})()

/** Catches a 3D failure (lost or refused WebGL context, driver crash) so the rest of the app keeps working. */
export class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('3D view disabled:', e) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

interface Props {
  risks: Record<VesselId, number>
  uncertain: Record<VesselId, boolean>
  selected: VesselId | null
  onSelect: (v: VesselId | null) => void
  compact?: boolean
}

// anterior view, patient's right on the viewer's left (radiological convention, as in the 3D scene)
const PATHS: Record<VesselId, string> = {
  RCA: 'M150 92 C 118 104, 96 132, 92 170 C 88 206, 104 240, 136 262 C 150 271, 166 276, 180 278',
  LAD: 'M196 96 C 206 128, 208 168, 202 206 C 197 238, 188 262, 180 286',
  LCX: 'M200 94 C 232 98, 262 118, 274 150 C 284 176, 282 204, 270 228',
}
const LABEL: Record<VesselId, [number, number]> = { RCA: [44, 176], LAD: [214, 222], LCX: [286, 150] }

/** 2D stand-in for the 3D heart when WebGL is unavailable: same per-artery colours, still clickable. */
export function Fallback2D({ risks, uncertain, selected, onSelect, compact }: Props) {
  return (
    <div className={`fallback2d ${compact ? 'is-compact' : ''}`}>
      <svg viewBox="0 0 340 320" role="img" aria-label="Simplified heart diagram coloured by predicted artery risk">
        <path d="M150 70 C 150 40, 182 30, 196 52 L 204 92" fill="none" stroke="#b9473f" strokeWidth="18" strokeLinecap="round" opacity="0.8" />
        <path d="M120 92 C 74 104, 64 176, 92 228 C 116 272, 156 300, 182 304 C 216 300, 262 268, 284 214 C 304 160, 288 106, 238 90 C 210 82, 168 80, 120 92 Z"
          fill="#5a2a2a" stroke="#7d3b37" strokeWidth="2" />
        {(Object.keys(PATHS) as VesselId[]).map((v) => {
          const on = selected === v
          return (
            <g key={v} onClick={() => onSelect(on ? null : v)} style={{ cursor: 'pointer' }}>
              <path d={PATHS[v]} fill="none" stroke="transparent" strokeWidth="22" />
              <path d={PATHS[v]} fill="none" stroke={riskHex(risks[v])} strokeWidth={on ? 9 : 6} strokeLinecap="round"
                strokeDasharray={uncertain[v] ? '10 7' : undefined} />
              <text x={LABEL[v][0]} y={LABEL[v][1]} fill="#eef3f6" fontSize="13" fontWeight="700">{v}</text>
              <text x={LABEL[v][0]} y={LABEL[v][1] + 16} fill={riskHex(risks[v])} fontSize="13" fontWeight="600">{pct(risks[v])}</text>
            </g>
          )
        })}
      </svg>
      {!compact && (
        <p className="fallback-note"><b>3D view unavailable on this device</b> (WebGL is turned off or not supported). All predictions, explanations and the report still work; this simplified diagram shows the same per-artery colours. Dashed = the model is unsure.</p>
      )}
    </div>
  )
}
