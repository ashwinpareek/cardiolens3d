import { useRef, useState } from 'react'

export const SERIES_COLORS: Record<string, string> = { CAD: '#2a78d6', LAD: '#eb6834', LCX: '#1baf7a', RCA: '#4a3aa7' }

export interface Series { id: string; label: string; pts: [number, number][]; color: string; dash?: string; meta?: string[] }

interface Props {
  series: Series[]
  xLabel: string
  yLabel: string
  x: [number, number]
  y: [number, number]
  diagonal?: boolean
  fmtX?: (v: number) => string
  fmtY?: (v: number) => string
  height?: number
  ariaLabel: string
}

/** Small multi-series line chart: thin 2px lines, recessive grid, direct end labels,
 *  legend row, and a crosshair tooltip that snaps to the nearest x on each series. */
export function LineChart({ series, xLabel, yLabel, x, y, diagonal, fmtX = (v) => v.toFixed(2), fmtY = (v) => v.toFixed(2), height = 190, ariaLabel }: Props) {
  const W = 300, H = height, m = { l: 42, r: 40, t: 8, b: 28 }
  const sx = (v: number) => m.l + ((v - x[0]) / (x[1] - x[0])) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - ((v - y[0]) / (y[1] - y[0])) * (H - m.t - m.b)
  const [hx, setHx] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const ticks = (a: number, b: number) => [0, 0.25, 0.5, 0.75, 1].map((t) => a + t * (b - a))

  const nearest = (s: Series, xv: number) => {
    let best = s.pts[0], bd = Infinity, bi = 0
    s.pts.forEach((p, i) => { const d = Math.abs(p[0] - xv); if (d < bd) { bd = d; best = p; bi = i } })
    return { p: best, i: bi }
  }

  const ends = series.map((s) => ({ s, p: s.pts[s.pts.length - 1] }))
  // spread end labels vertically so they do not collide
  const placed = ends.map((e) => ({ ...e, y: sy(e.p[1]) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 11) placed[i].y = placed[i - 1].y + 11

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-2)', marginBottom: 2 }}>
        {series.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="14" height="6"><line x1="0" x2="14" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} /></svg>{s.label}
          </span>
        ))}
      </div>
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const v = x[0] + ((px - m.l) / (W - m.l - m.r)) * (x[1] - x[0])
          setHx(v >= x[0] && v <= x[1] ? v : null)
        }}
        onMouseLeave={() => setHx(null)}>
        {ticks(...y).map((t) => (
          <g key={'y' + t}>
            <line className="grid" x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text x={m.l - 5} y={sy(t) + 3} textAnchor="end">{fmtY(t)}</text>
          </g>
        ))}
        {ticks(...x).map((t) => <text key={'x' + t} x={sx(t)} y={H - m.b + 12} textAnchor="middle">{fmtX(t)}</text>)}
        <line className="axis-line" x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} />
        <text x={(m.l + W - m.r) / 2} y={H - 3} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(8 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        {diagonal && <line x1={sx(x[0])} y1={sy(y[0])} x2={sx(x[1])} y2={sy(y[1])} stroke="var(--line)" strokeDasharray="3 3" />}
        {series.map((s) => (
          <polyline key={s.id} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round"
            points={s.pts.map((p) => `${sx(p[0])},${sy(Math.max(y[0], Math.min(y[1], p[1])))}`).join(' ')} />
        ))}
        {placed.map(({ s, p, y: ly }) => (
          <g key={'l' + s.id}>
            <text x={sx(p[0]) + 4} y={ly + 3} style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{s.label}</text>
          </g>
        ))}
        {hx != null && (
          <g>
            <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={H - m.b} stroke="var(--muted)" strokeWidth={0.75} />
            {series.map((s) => { const { p } = nearest(s, hx); return <circle key={s.id} cx={sx(p[0])} cy={sy(p[1])} r={3.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} /> })}
          </g>
        )}
      </svg>
      {hx != null && (
        <div style={{ position: 'absolute', top: 18, left: `${Math.min(62, (sx(hx) / W) * 100 + 3)}%`, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', fontSize: 11, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', whiteSpace: 'nowrap' }}>
          <div style={{ color: 'var(--muted)' }}>{xLabel} {fmtX(hx)}</div>
          {series.map((s) => { const { p, i } = nearest(s, hx); return (
            <div key={s.id}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />{s.label}: <b>{fmtY(p[1])}</b>{s.meta?.[i] ? <span style={{ color: 'var(--muted)' }}> {s.meta[i]}</span> : null}</div>
          ) })}
        </div>
      )}
    </div>
  )
}
