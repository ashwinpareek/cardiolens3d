import { riskHex } from '../lib/risk'
import type { VesselId } from '../lib/types'

/** AHA 17-segment polar map (Cerqueira et al., Circulation 2002) with the standard
 *  segment-to-coronary territory assignment. Anterior is up, septum left, lateral right. */
export const AHA_TERRITORY: Record<number, VesselId> = {
  1: 'LAD', 2: 'LAD', 7: 'LAD', 8: 'LAD', 13: 'LAD', 14: 'LAD', 17: 'LAD',
  3: 'RCA', 4: 'RCA', 9: 'RCA', 10: 'RCA', 15: 'RCA',
  5: 'LCX', 6: 'LCX', 11: 'LCX', 12: 'LCX', 16: 'LCX',
}
const NAMES: Record<number, string> = {
  1: 'basal anterior', 2: 'basal anteroseptal', 3: 'basal inferoseptal', 4: 'basal inferior', 5: 'basal inferolateral', 6: 'basal anterolateral',
  7: 'mid anterior', 8: 'mid anteroseptal', 9: 'mid inferoseptal', 10: 'mid inferior', 11: 'mid inferolateral', 12: 'mid anterolateral',
  13: 'apical anterior', 14: 'apical septal', 15: 'apical inferior', 16: 'apical lateral', 17: 'apex',
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  // angles in degrees, 0 = +x, counter-clockwise, SVG y is down so negate sin
  const p = (r: number, a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy - r * Math.sin((a * Math.PI) / 180)]
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 1 ${x3},${y3} Z`
}

export function Bullseye({ risks, selected, onSelect }: { risks: Record<VesselId, number>; selected: VesselId | null; onSelect: (v: VesselId) => void }) {
  const c = 75
  const segs: { n: number; d: string; mid: [number, number] }[] = []
  const ring = (start: number, count: number, r0: number, r1: number, a0: number) => {
    const step = 360 / count
    for (let i = 0; i < count; i++) {
      const s = a0 + i * step
      const m = ((s + step / 2) * Math.PI) / 180, rr = (r0 + r1) / 2
      segs.push({ n: start + i, d: arc(c, c, r0, r1, s, s + step), mid: [c + rr * Math.cos(m), c - rr * Math.sin(m)] })
    }
  }
  ring(1, 6, 52, 73, 60)  // basal: segment 1 centred at 90° (anterior)
  ring(7, 6, 32, 52, 60)  // mid
  ring(13, 4, 13, 32, 45) // apical: 13 anterior centred at 90°
  return (
    <svg className="bullseye" viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="AHA 17-segment map coloured by territory risk">
      {segs.map((s) => {
        const v = AHA_TERRITORY[s.n]
        return (
          <path key={s.n} d={s.d} fill={riskHex(risks[v])} className={selected && selected !== v ? 'dim' : ''} onClick={() => onSelect(v)}>
            <title>{`Segment ${s.n} · ${NAMES[s.n]} · ${v} territory`}</title>
          </path>
        )
      })}
      <circle cx={c} cy={c} r={13} fill={riskHex(risks.LAD)} className={selected && selected !== 'LAD' ? 'dim' : ''} stroke="var(--panel)" strokeWidth={1.2} onClick={() => onSelect('LAD')} style={{ cursor: 'pointer' }}>
        <title>Segment 17 · apex · LAD territory</title>
      </circle>
      {segs.map((s) => <text key={s.n} x={s.mid[0]} y={s.mid[1] + 3} textAnchor="middle">{s.n}</text>)}
      <text x={c} y={c + 3} textAnchor="middle">17</text>
    </svg>
  )
}
