import { riskColor, riskHex, pct } from '../lib/risk'

/** Semicircular risk dial. The arc is painted with the shared risk ramp; the needle shows p,
 *  and a light band shows the 90% interval. */
export function Gauge({ p, lo, hi, size = 220, label }: { p: number; lo?: number; hi?: number; size?: number; label?: string }) {
  const W = size, H = size * 0.62, cx = W / 2, cy = H - 8, R = W / 2 - 14
  const ang = (v: number) => Math.PI * (1 - v)
  const pt = (v: number, r = R) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))]
  const segs = 48
  const arcs = Array.from({ length: segs }, (_, i) => {
    const a = i / segs, b = (i + 1) / segs
    const [x0, y0] = pt(a), [x1, y1] = pt(b)
    return <path key={i} d={`M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1}`} stroke={'#' + riskColor((a + b) / 2).getHexString()} strokeWidth={14} fill="none" />
  })
  const band = lo != null && hi != null && hi - lo > 0.005 ? (() => {
    const [x0, y0] = pt(lo, R + 12), [x1, y1] = pt(hi, R + 12)
    return <path d={`M${x0},${y0} A${R + 12},${R + 12} 0 0 1 ${x1},${y1}`} stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" fill="none" />
  })() : null
  const [nx, ny] = pt(p, R - 22)
  return (
    <svg className="gauge" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label ?? 'Risk'} ${pct(p)}`}>
      <g opacity={0.95}>{arcs}</g>
      {band}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth={3} strokeLinecap="round" style={{ transition: 'all .5s' }} />
      <circle cx={cx} cy={cy} r={7} fill="var(--ink)" />
      <text x={cx} y={cy - R * 0.38} textAnchor="middle" className="gauge-val" style={{ fill: riskHex(p) }}>{pct(p)}</text>
      <text x={14} y={H - 2} className="gauge-tick">0%</text>
      <text x={W - 14} y={H - 2} textAnchor="end" className="gauge-tick">100%</text>
    </svg>
  )
}
