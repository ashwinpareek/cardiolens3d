import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { riskColor } from '../lib/risk'
import type { VesselId } from '../lib/types'

/** centrelines.json: target -> list of { part, pts: [x,y,z][] } polylines rooted at the ostium. */
export type Centerlines = Record<string, { part: string; pts: number[][] }[]>

interface Path { target: VesselId | 'LM'; pts: Float32Array; cum: Float32Array; len: number }

const SPACING = 0.055 // scene units between particles along a path (~5.5 mm)

/** Blood-flow tracer particles streaming from each ostium to the distal tips.
 *  Colour = the vessel's predicted stenosis probability. Speed drops as risk rises, so a
 *  high-risk vessel visibly "slows down" -- a metaphor, not a haemodynamic simulation. */
export function FlowParticles({ centerlines, risks }: { centerlines: Centerlines; risks: Record<VesselId, number> }) {
  const { paths, offsets, pathIdx, count } = useMemo(() => {
    const paths: Path[] = []
    for (const [target, list] of Object.entries(centerlines)) {
      for (const { pts } of list) {
        if (pts.length < 3) continue
        const f = new Float32Array(pts.flat())
        const cum = new Float32Array(pts.length)
        for (let i = 1; i < pts.length; i++) {
          const dx = f[i * 3] - f[i * 3 - 3], dy = f[i * 3 + 1] - f[i * 3 - 2], dz = f[i * 3 + 2] - f[i * 3 - 1]
          cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz)
        }
        paths.push({ target: target as VesselId, pts: f, cum, len: cum[pts.length - 1] })
      }
    }
    const offsets: number[] = []
    const pathIdx: number[] = []
    paths.forEach((p, i) => {
      const n = Math.max(2, Math.round(p.len / SPACING))
      for (let k = 0; k < n; k++) { offsets.push(k / n + Math.random() * 0.3 / n); pathIdx.push(i) }
    })
    return { paths, offsets: new Float32Array(offsets), pathIdx: new Uint16Array(pathIdx), count: offsets.length }
  }, [centerlines])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(count), 1))
    return g
  }, [count])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 22.0 } },
    vertexShader: `attribute vec3 color; attribute float aT; varying vec3 vC; varying float vT;
      uniform float uSize;
      void main(){ vC = color; vT = aT; vec4 mv = modelViewMatrix * vec4(position,1.0);
        mv.xyz += normalize(-mv.xyz) * 0.03; // lift toward camera so tracers ride on top of the vessel wall
        gl_PointSize = uSize * (1.0 - 0.45 * aT) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vT;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35*a), a * (0.95 - 0.5*vT)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [])

  const phase = useRef(offsets.slice())
  const c = useMemo(() => new THREE.Color(), [])

  useFrame((_, dt) => {
    const pos = geom.attributes.position.array as Float32Array
    const col = geom.attributes.color.array as Float32Array
    const tt = geom.attributes.aT.array as Float32Array
    const speedCache: Record<string, number> = {}
    const colCache: Record<string, THREE.Color> = {}
    for (const t of ['LAD', 'LCX', 'RCA', 'LM'] as const) {
      const r = t === 'LM' ? Math.max(risks.LAD, risks.LCX) : risks[t]
      speedCache[t] = 0.30 * (1 - 0.7 * r) // units / s
      colCache[t] = riskColor(r, new THREE.Color())
    }
    const ph = phase.current
    for (let i = 0; i < count; i++) {
      const p = paths[pathIdx[i]]
      ph[i] = (ph[i] + (speedCache[p.target] * Math.min(dt, 0.05)) / p.len) % 1
      const s = ph[i] * p.len
      // binary search along cumulative length
      let lo = 0, hi = p.cum.length - 1
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] < s) lo = m; else hi = m }
      const seg = p.cum[hi] - p.cum[lo] || 1
      const f = (s - p.cum[lo]) / seg
      const a = lo * 3, b = hi * 3
      pos[i * 3] = p.pts[a] + (p.pts[b] - p.pts[a]) * f
      pos[i * 3 + 1] = p.pts[a + 1] + (p.pts[b + 1] - p.pts[a + 1]) * f
      pos[i * 3 + 2] = p.pts[a + 2] + (p.pts[b + 2] - p.pts[a + 2]) * f
      const cc = colCache[p.target]
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b
      tt[i] = ph[i]
    }
    geom.attributes.position.needsUpdate = true
    geom.attributes.color.needsUpdate = true
    geom.attributes.aT.needsUpdate = true
  })

  void c
  return <points geometry={geom} material={mat} frustumCulled={false} renderOrder={5} />
}
