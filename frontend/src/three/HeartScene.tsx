import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import { riskColor } from '../lib/risk'
import { FlowParticles, Centerlines } from './FlowParticles'
import type { VesselId } from '../lib/types'

export type ViewMode = 'heart' | 'torso'

export interface SceneProps {
  risks: Record<VesselId, number>      // LAD, LCX, RCA probabilities (calibrated)
  uncertain: Record<VesselId, boolean> // conformal set contains both classes
  selected: VesselId | null
  onSelect: (v: VesselId | null) => void
  bpm: number
  view: ViewMode
  territory: boolean
  flow: boolean
  labels: boolean
  beating: boolean
  registry: AnatomyPart[]
  centerlines: Centerlines | null
  base: string
}

export interface AnatomyPart {
  id: string; label: string; group: string; target?: string; parent?: string; description?: string
}

const VESSELS: VesselId[] = ['LAD', 'LCX', 'RCA']
const ANATOMY_COLORS: Record<string, string> = {
  aorta_asc: '#b5524f', aorta_arch: '#b5524f', aorta_desc: '#b5524f',
  svc: '#56689a', ivc: '#56689a', pulm_vein: '#b86a6a', pulm_artery: '#6f6fa8',
  cardiac_veins: '#4f63a0', trachea: '#c9c2b0', diaphragm: '#a7655b',
}

/* --------------------------------------------------------------------------------------------
 * Shader patches. All are applied with onBeforeCompile on MeshStandardMaterial so lighting,
 * shadows and tone-mapping stay physically based and cheap (no custom lighting code).
 * ------------------------------------------------------------------------------------------*/

/** Myocardium: per-vertex territory weights (COLOR_0 = [wLAD, wLCX, wRCA]) blend the base muscle
 *  colour toward each vessel's current risk colour. */
function makeMyocardiumMaterial() {
  const uniforms = {
    uLAD: { value: new THREE.Color() }, uLCX: { value: new THREE.Color() }, uRCA: { value: new THREE.Color() },
    uAmount: { value: 1 }, uSel: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRisk: { value: new THREE.Vector3() },
  }
  const m = new THREE.MeshStandardMaterial({ color: '#9a5a52', roughness: 0.62, metalness: 0.0, vertexColors: true })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLAD; uniform vec3 uLCX; uniform vec3 uRCA; uniform float uAmount; uniform vec3 uSel; uniform float uTime; uniform vec3 uRisk;`)
      .replace('#include <color_fragment>', `
        vec3 w = vColor.rgb;
        float s = clamp(w.r + w.g + w.b, 0.0, 1.0);
        vec3 tint = (w.r * uLAD + w.g * uLCX + w.b * uRCA) / max(s, 1e-3);
        float sel = dot(w, uSel);
        float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
        float r = dot(w, uRisk) / max(s, 1e-3);           // risk of the territory this point belongs to
        float k = uAmount * s * (0.10 + 0.45 * r + 0.35 * sel * pulse); // healthy muscle stays muscle-coloured
        diffuseColor.rgb = mix(diffuseColor.rgb, tint, k);
      `)
  }
  return { m, uniforms }
}

/** Fades geometry outside a sphere around the heart, used to "dissolve" the thorax and the far
 *  ends of the great vessels when switching to the heart-focus view. */
function addRadialFade(m: THREE.Material, u: { uRadius: { value: number } }) {
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r)
    sh.uniforms.uRadius = u.uRadius
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uRadius;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float d = length(vWPos);
        float f = 1.0 - smoothstep(uRadius * 0.82, uRadius, d);
        if (f < 0.01) discard;
        gl_FragColor.a *= f;`)
  }
  m.transparent = true
}

/** Fresnel "ghost" body surface: only grazing angles are visible, so the torso reads as a
 *  silhouette that never hides the heart. */
function makeGhostMaterial(color: string, power = 2.2, strength = 0.38) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), ${power.toFixed(1)});
        gl_FragColor = vec4(uColor, f * ${strength.toFixed(2)} * uOpacity); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
}

/* ------------------------------------------------------------------------------------------ */

function beatCurve(phase: number) {
  // phase in [0,1): fast systolic contraction then slower diastolic relaxation
  if (phase < 0.32) return Math.sin((phase / 0.32) * Math.PI * 0.5)
  if (phase < 0.62) return Math.cos(((phase - 0.32) / 0.3) * Math.PI * 0.5)
  return 0
}

export function HeartScene(props: SceneProps) {
  const { risks, uncertain, selected, onSelect, bpm, view, territory, flow, labels, beating, registry, centerlines, base } = props
  // meshopt-compressed (decoder bundled, no CDN). The static demo ships the same model as embedded .gltf JSON
  // because some static hosts only serve web media types.
  const gltf = useGLTF(`${base}anatomy/${import.meta.env.VITE_STATIC_DEMO === '1' ? 'heart_scene.json' : 'heart_scene.glb'}`, false, true)
  const heartGroup = useRef<THREE.Group>(null!)
  const [hover, setHover] = useState<string | null>(null)
  const { camera, gl } = useThree()
  const controls = useRef<any>(null)

  const regById = useMemo(() => Object.fromEntries(registry.map((p) => [p.id, p])), [registry])

  // ---- one-time material setup
  const setup = useMemo(() => {
    const radial = { uRadius: { value: 40 } }
    const myo = makeMyocardiumMaterial()
    const vesselMats: Record<string, THREE.MeshStandardMaterial> = {}
    const meshes: { heart: THREE.Object3D[]; rest: THREE.Object3D[] } = { heart: [], rest: [] }
    const fadeMats: THREE.Material[] = []
    const ghost = makeGhostMaterial('#cfe3ef', 2.4, 0.42)
    const lungGhost = makeGhostMaterial('#f2c3c0', 1.6, 0.30)
    const bone = new THREE.MeshStandardMaterial({ color: '#e8dfcf', roughness: 0.8, transparent: true, opacity: 0.5, depthWrite: false })
    const diaphragm = new THREE.MeshStandardMaterial({ color: ANATOMY_COLORS.diaphragm, roughness: 0.7, transparent: true, opacity: 0.35, depthWrite: false })
    const thorax: [THREE.Material, number][] = [[bone, 0.5], [diaphragm, 0.35]]

    const root = gltf.scene.clone(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const id = mesh.name.replace(/_\d+$/, '')
      const part = regById[id] ?? regById[mesh.parent?.name ?? '']
      mesh.userData.partId = part?.id ?? id
      mesh.geometry.computeVertexNormals()
      const pid = mesh.userData.partId as string
      if (pid === 'heart_wall') {
        mesh.material = myo.m
        meshes.heart.push(mesh)
      } else if (part?.group === 'coronary') {
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05, emissiveIntensity: 0.55 })
        vesselMats[pid] = mat
        mesh.material = mat
        mesh.userData.target = part.target
        meshes.heart.push(mesh)
      } else if (pid === 'cardiac_veins') {
        mesh.material = new THREE.MeshStandardMaterial({ color: ANATOMY_COLORS.cardiac_veins, roughness: 0.5, transparent: true, opacity: 0.85 })
        meshes.heart.push(mesh)
      } else if (pid === 'diaphragm') {
        mesh.material = diaphragm
        mesh.renderOrder = 3
        meshes.rest.push(mesh)
      } else if (part?.group === 'great_vessels' || pid === 'trachea') {
        const mat = new THREE.MeshStandardMaterial({ color: ANATOMY_COLORS[pid] ?? '#999', roughness: 0.55 })
        addRadialFade(mat, radial)
        fadeMats.push(mat)
        mesh.material = mat
        mesh.renderOrder = 1
        meshes.rest.push(mesh)
      } else if (pid === 'skin') {
        mesh.material = ghost
        mesh.renderOrder = 10
        meshes.rest.push(mesh)
      } else if (pid === 'lungs') {
        mesh.material = lungGhost
        mesh.renderOrder = 9
        meshes.rest.push(mesh)
      } else {
        mesh.material = bone
        mesh.renderOrder = 2
        meshes.rest.push(mesh)
      }
    })
    const heart = new THREE.Group()
    meshes.heart.forEach((m) => heart.add(m))
    const rest = new THREE.Group()
    meshes.rest.forEach((m) => rest.add(m))
    return { heart, rest, myo, vesselMats, radial, ghost, lungGhost, fadeMats, thorax }
  }, [gltf, regById])

  // ---- animated state (smoothly interpolated toward targets every frame)
  const anim = useRef({ LAD: 0, LCX: 0, RCA: 0, terr: 1, radius: 40, ghost: 1, phase: 0 })
  const tmp = useMemo(() => new THREE.Color(), [])
  const camTarget = useRef<{ pos: THREE.Vector3; look: THREE.Vector3 } | null>(null)

  useEffect(() => {
    // camera presets
    camTarget.current = view === 'heart'
      ? { pos: new THREE.Vector3(1.25, 0.45, 2.75), look: new THREE.Vector3(0.05, -0.05, 0) }
      : { pos: new THREE.Vector3(0.6, 0.9, 7.8), look: new THREE.Vector3(0, 0.25, 0) }
  }, [view])

  useFrame((state, dt) => {
    const a = anim.current
    const k = 1 - Math.exp(-dt * 5)
    for (const v of VESSELS) a[v] += (risks[v] - a[v]) * k
    a.terr += ((territory ? 1 : 0) - a.terr) * k
    a.radius += ((view === 'heart' ? 0.85 : 14) - a.radius) * (1 - Math.exp(-dt * 2.2))
    a.ghost += ((view === 'heart' ? 0 : 1) - a.ghost) * k
    const t = state.clock.elapsedTime

    // vessels
    for (const [pid, mat] of Object.entries(setup.vesselMats)) {
      const tgt = regById[pid]?.target as string
      const p = tgt === 'LM' ? Math.max(a.LAD, a.LCX) : a[tgt as VesselId]
      riskColor(p, tmp)
      mat.color.copy(tmp)
      const isSel = selected && (tgt === selected || (tgt === 'LM' && (selected === 'LAD' || selected === 'LCX')))
      const isHover = hover && regById[hover]?.target === tgt
      const unc = tgt !== 'LM' && uncertain[tgt as VesselId]
      const flicker = unc ? 0.18 * (0.5 + 0.5 * Math.sin(t * 7.0)) : 0
      mat.emissive.copy(tmp)
      mat.emissiveIntensity = 0.25 + 0.45 * p + (isSel ? 0.35 + 0.25 * Math.sin(t * 4) : 0) + (isHover ? 0.25 : 0) + flicker
    }
    // myocardium territory tint
    const u = setup.myo.uniforms
    riskColor(a.LAD, u.uLAD.value); riskColor(a.LCX, u.uLCX.value); riskColor(a.RCA, u.uRCA.value)
    u.uAmount.value = a.terr
    u.uRisk.value.set(a.LAD, a.LCX, a.RCA)
    u.uTime.value = t
    u.uSel.value.set(selected === 'LAD' ? 1 : 0, selected === 'LCX' ? 1 : 0, selected === 'RCA' ? 1 : 0)
    setup.radial.uRadius.value = a.radius
    setup.ghost.uniforms.uOpacity.value = a.ghost
    setup.lungGhost.uniforms.uOpacity.value = a.ghost
    for (const [m, o] of setup.thorax) { m.opacity = o * a.ghost; m.visible = a.ghost > 0.01 }
    setup.ghost.visible = setup.lungGhost.visible = a.ghost > 0.01

    // heartbeat at the patient's pulse rate
    if (beating) a.phase = (a.phase + dt * (bpm / 60)) % 1
    const s = 1 + 0.022 * beatCurve(a.phase)
    heartGroup.current.scale.set(s, s * 0.992 + 0.008, s)

    // camera glide
    const ct = camTarget.current
    if (ct && controls.current) {
      camera.position.lerp(ct.pos, 1 - Math.exp(-dt * 3))
      controls.current.target.lerp(ct.look, 1 - Math.exp(-dt * 3))
      controls.current.update()
      if (camera.position.distanceTo(ct.pos) < 0.02) camTarget.current = null
    }
  })

  // fly to a viewpoint where the selected vessel is in view (heart view only)
  useEffect(() => {
    if (!selected || view !== 'heart') return
    const presets: Record<VesselId, [number[], number[]]> = {
      LAD: [[0.75, 0.55, 2.75], [0.15, -0.05, 0.1]],   // anterior: interventricular groove
      LCX: [[2.75, 0.55, -0.6], [0.25, 0.05, -0.1]],   // left lateral: AV groove behind the left atrial appendage
      RCA: [[-1.9, -0.35, 2.15], [-0.1, -0.1, 0.1]],   // right anterior oblique, slightly inferior
    }
    const [pos, look] = presets[selected]
    camTarget.current = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) }
  }, [selected, view])

  // stop camera glide as soon as the user grabs the controls
  useEffect(() => {
    const stop = () => { camTarget.current = null }
    gl.domElement.addEventListener('pointerdown', stop)
    gl.domElement.addEventListener('wheel', stop, { passive: true })
    return () => { gl.domElement.removeEventListener('pointerdown', stop); gl.domElement.removeEventListener('wheel', stop) }
  }, [gl])

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const o = e.intersections.find((i) => (i.object.userData.target as string | undefined))?.object
    return o ? (o.userData.target as string) : null
  }

  // label anchors: a point ~35% down the longest centreline of each vessel
  const anchors = useMemo(() => {
    const res: Partial<Record<VesselId, THREE.Vector3>> = {}
    if (!centerlines) return res
    for (const v of VESSELS) {
      const paths = centerlines[v] ?? []
      const main = paths.reduce((b, p) => (p.pts.length > (b?.pts.length ?? 0) ? p : b), paths[0])
      if (main) {
        const q = main.pts[Math.floor(main.pts.length * ({ LAD: 0.45, LCX: 0.7, RCA: 0.3 } as const)[v])]
        res[v] = new THREE.Vector3(q[0], q[1], q[2])
      }
    }
    return res
  }, [centerlines])

  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={1.4} maxDistance={14} />
      <hemisphereLight args={['#dfeaf2', '#3a2626', 0.9]} />
      <directionalLight position={[2.5, 3, 4]} intensity={1.6} />
      <directionalLight position={[-3, 1, -3]} intensity={0.7} color="#9fc4ff" />
      <directionalLight position={[0, -2, 3]} intensity={0.35} color="#ffd9c7" />

      <primitive object={setup.rest} />
      <group ref={heartGroup}>
        <primitive
          object={setup.heart}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            const t = pick(e)
            const id = (e.intersections.find((i) => i.object.userData.target)?.object.userData.partId as string) ?? null
            setHover(t ? id : null)
            document.body.style.cursor = t ? 'pointer' : 'auto'
          }}
          onPointerOut={() => { setHover(null); document.body.style.cursor = 'auto' }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation()
            const t = pick(e)
            if (t === 'LM') onSelect('LAD')
            else if (t) onSelect(t as VesselId)
          }}
          onPointerMissed={() => onSelect(null)}
        />
        {centerlines && flow && <FlowParticles centerlines={centerlines} risks={risks} />}
        {labels && view === 'heart' && VESSELS.map((v) => anchors[v] && (
          <Html key={v} position={anchors[v]!} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`vlabel ${selected === v ? 'is-sel' : ''}`} style={{ ['--c' as any]: '#' + riskColor(risks[v]).getHexString() }}>
              <b>{v}</b><span>{Math.round(risks[v] * 100)}%</span>
            </div>
          </Html>
        ))}
      </group>
      {hover && regById[hover] && (
        <Html position={[0, -1.05, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="hovertip">{regById[hover].label}</div>
        </Html>
      )}
    </>
  )
}
