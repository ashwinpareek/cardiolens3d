import * as THREE from 'three'

/** Risk colour ramp shared by the 3D scene and every 2D panel, so a colour means the same
 *  probability everywhere. Stops: patent teal -> amber -> stenotic crimson. */
const STOPS: [number, string][] = [
  [0.0, '#2fb5a3'],
  [0.35, '#8fc06a'],
  [0.55, '#e7b443'],
  [0.75, '#e07a3c'],
  [1.0, '#d43d3d'],
]
const COLS = STOPS.map(([p, c]) => [p, new THREE.Color(c)] as const)

export function riskColor(p: number, out = new THREE.Color()): THREE.Color {
  const x = Math.min(1, Math.max(0, p))
  for (let i = 1; i < COLS.length; i++) {
    const [p1, c1] = COLS[i]
    const [p0, c0] = COLS[i - 1]
    if (x <= p1) return out.copy(c0).lerp(c1, (x - p0) / (p1 - p0))
  }
  return out.copy(COLS[COLS.length - 1][1])
}

export const riskHex = (p: number) => '#' + riskColor(p).getHexString()

export function riskBand(p: number): { label: string; tone: 'low' | 'mid' | 'high' } {
  if (p < 0.3) return { label: 'Low', tone: 'low' }
  if (p < 0.6) return { label: 'Intermediate', tone: 'mid' }
  return { label: 'High', tone: 'high' }
}

export const pct = (p: number, d = 0) => {
  // display rounding never claims certainty: 99.6% shows as ">99%", 0.3% as "<1%"
  if (d === 0 && p > 0.995) return '>99%'
  if (d === 0 && p < 0.005) return '<1%'
  return `${(p * 100).toFixed(d)}%`
}

export const riskGradientCss = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `${c} ${p * 100}%`).join(', ')})`
