import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import { GLTFLoader } from 'three-stdlib'
import { suspend } from 'suspend-react'
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
  cut?: number            // 0 = intact, 1 = front half of the heart wall cut away (cross-section)
  angio?: boolean         // cath-lab X-ray look: contrast-filled arteries on a grey fluoroscopy field
  lift?: number           // 0..1 exploded view: arteries lifted off the heart surface
  focus?: FocusId | null  // camera preset requested by the guided tour
  focusKey?: number       // bump to re-fly to the same preset
  compact?: boolean       // small embedded viewer (what-if page)
  shift?: number          // 0..0.5: slide the rendered heart left (fraction of width) to make room for a side panel
  autoRotate?: boolean    // slow showcase turntable, stopped by the parent on first interaction
}

export type FocusId = 'overview' | 'LAD' | 'LCX' | 'RCA' | 'inferior' | 'thorax'

export interface AnatomyPart {
  id: string; label: string; group: string; target?: string; parent?: string; description?: string
}

const VESSELS: VesselId[] = ['LAD', 'LCX', 'RCA']
const ANGIO_DARK = new THREE.Color('#1d2226')
const GREY = new THREE.Color('#7b8388')
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
    uAngio: { value: 0 },
  }
  const m = new THREE.MeshStandardMaterial({ color: '#9a5a52', roughness: 0.62, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLAD; uniform vec3 uLCX; uniform vec3 uRCA; uniform float uAmount; uniform vec3 uSel; uniform float uTime; uniform vec3 uRisk; uniform float uAngio;`)
      .replace('#include <color_fragment>', `
        vec3 w = vColor.rgb;
        float s = clamp(w.r + w.g + w.b, 0.0, 1.0);
        vec3 tint = (w.r * uLAD + w.g * uLCX + w.b * uRCA) / max(s, 1e-3);
        float sel = dot(w, uSel);
        float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
        float r = dot(w, uRisk) / max(s, 1e-3);           // risk of the territory this point belongs to
        float k = uAmount * s * (0.10 + 0.45 * r + 0.35 * sel * pulse); // healthy muscle stays muscle-coloured
        diffuseColor.rgb = mix(diffuseColor.rgb, tint, k);
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.42, 0.13, 0.13) * (0.8 + 0.2 * w.r); // inside of the cut: chamber wall
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.66), uAngio);
        diffuseColor.a *= 1.0 - 0.72 * uAngio;
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

/** camera position + look-at for each named view (heart-centred frame, anterior = +z, patient-left = +x) */
export const CAMERA_PRESETS: Record<FocusId, [[number, number, number], [number, number, number]]> = {
  overview: [[1.25, 0.45, 2.75], [0.05, -0.05, 0]],
  LAD: [[0.75, 0.55, 2.75], [0.15, -0.05, 0.1]],    // anterior: interventricular groove
  LCX: [[2.75, 0.55, -0.6], [0.25, 0.05, -0.1]],    // left lateral: AV groove behind the left atrial appendage
  RCA: [[-1.9, -0.35, 2.15], [-0.1, -0.1, 0.1]],    // right anterior oblique, slightly inferior
  inferior: [[0.4, -2.6, 1.0], [0.1, -0.2, 0]],     // from below: PDA and inferior wall
  thorax: [[0.6, 0.9, 7.8], [0, 0.25, 0]],
}

function beatCurve(phase: number) {
  // phase in [0,1): fast systolic contraction then slower diastolic relaxation
  if (phase < 0.32) return Math.sin((phase / 0.32) * Math.PI * 0.5)
  if (phase < 0.62) return Math.cos(((phase - 0.32) / 0.3) * Math.PI * 0.5)
  return 0
}

export function HeartScene(props: SceneProps) {
  const { risks, uncertain, selected, onSelect, bpm, view, territory, flow, labels, beating, registry, centerlines, base } = props
  const cut = props.cut ?? 0, angio = !!props.angio, lift = props.lift ?? 0
  // meshopt-compressed (decoder bundled, no CDN). The static demo ships the same model as embedded .gltf JSON
  // because some static hosts only serve web media types.
  // A single-file build embeds the model bytes; parse them directly (no network request at all).
  const embedded = (window as any).__CL_EMBED__?.glbBuffer as ArrayBuffer | undefined
  const gltf: { scene: THREE.Group } = embedded
    ? suspend(() => new Promise<any>((res, rej) => new GLTFLoader().parse(embedded, '', res, rej)), ['cardiolens-embedded-glb'])
    : useGLTF(`${base}anatomy/${import.meta.env.VITE_STATIC_DEMO === '1' ? 'heart_scene.json' : 'heart_scene.glb'}`, false, true)
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
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2)  // keeps z <= constant (anterior = +z)
    myo.m.clippingPlanes = [clip]
    myo.m.transparent = true
    const veinMat = new THREE.MeshStandardMaterial({ color: ANATOMY_COLORS.cardiac_veins, roughness: 0.5, transparent: true, opacity: 0.85, clippingPlanes: [clip] })
    const vesselMeshes: THREE.Mesh[] = []

    const root = gltf.scene.clone(true)
    root.traverse((o: THREE.Object3D) => {
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
        mesh.geometry.computeBoundingSphere()
        mesh.userData.home = mesh.position.clone()
        vesselMeshes.push(mesh)
        meshes.heart.push(mesh)
      } else if (pid === 'cardiac_veins') {
        mesh.material = veinMat
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
    // exploded view: each vessel tree moves outward along the direction from the heart centre to its centroid
    const centroid: Record<string, THREE.Vector3> = {}
    for (const m of vesselMeshes) {
      const t = m.userData.target as string
      m.updateMatrix()
      const c = m.geometry.boundingSphere!.center.clone().applyMatrix4(m.matrix)
      ;(centroid[t] ??= new THREE.Vector3()).add(c.multiplyScalar(1 / vesselMeshes.filter((x) => x.userData.target === t).length))
    }
    for (const m of vesselMeshes) {
      const c = centroid[m.userData.target as string].clone()
      c.y *= 0.4
      m.userData.liftDir = c.lengthSq() > 1e-6 ? c.normalize() : new THREE.Vector3(0, 0, 1)
    }
    const liftDir: Record<string, THREE.Vector3> = Object.fromEntries(Object.entries(centroid).map(([k, c]) => {
      const d = c.clone(); d.y *= 0.4; return [k, d.normalize()]
    }))
    return { heart, rest, myo, vesselMats, radial, ghost, lungGhost, fadeMats, thorax, clip, veinMat, vesselMeshes, liftDir, otherMats: [veinMat] }
  }, [gltf, regById])

  // ---- animated state (smoothly interpolated toward targets every frame)
  const anim = useRef({ LAD: 0, LCX: 0, RCA: 0, terr: 1, radius: 40, ghost: 1, phase: 0, cut: 0, angio: 0, lift: 0, shift: 0 })
  const size = useThree((s) => s.size)
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
    a.cut += (cut - a.cut) * k
    a.angio += ((angio ? 1 : 0) - a.angio) * k
    a.lift += (lift - a.lift) * k
    a.shift += ((props.shift ?? 0) - a.shift) * k
    {
      const cam = camera as THREE.PerspectiveCamera
      if (Math.abs(a.shift) > 0.002) cam.setViewOffset(size.width, size.height, a.shift * size.width, 0, size.width, size.height)
      else if (cam.view) cam.clearViewOffset()
    }
    const t = state.clock.elapsedTime
    // cross-section plane sweeps from in front of the heart (no cut) to just behind its centre
    setup.clip.constant = 1.2 - a.cut * 1.25
    for (const m of setup.vesselMeshes) {
      const d = setup.liftDir[m.userData.target as string] ?? m.userData.liftDir
      m.position.copy(m.userData.home).addScaledVector(d, a.lift * 0.32)
    }
    setup.veinMat.opacity = 0.85 * (1 - a.angio) * (1 - a.lift)
    setup.veinMat.visible = setup.veinMat.opacity > 0.02
    for (const m of setup.fadeMats) (m as THREE.MeshStandardMaterial).opacity = 1 - 0.8 * a.angio

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
      const dim = selected && !isSel ? 0.55 : 0      // focus mode: other arteries step back
      // angiogram: contrast-filled arteries read dark on the grey field; risk keeps a coloured halo
      mat.color.lerp(ANGIO_DARK, a.angio * 0.88)
      mat.color.lerp(GREY, dim)
      mat.emissive.copy(tmp)
      mat.emissiveIntensity = (0.25 + 0.45 * p + (isSel ? 0.35 + 0.25 * Math.sin(t * 4) : 0) + (isHover ? 0.25 : 0) + flicker) * (1 - 0.72 * a.angio) * (1 - 0.7 * dim)
    }
    // myocardium territory tint
    const u = setup.myo.uniforms
    riskColor(a.LAD, u.uLAD.value); riskColor(a.LCX, u.uLCX.value); riskColor(a.RCA, u.uRCA.value)
    u.uAmount.value = a.terr
    u.uRisk.value.set(a.LAD, a.LCX, a.RCA)
    u.uTime.value = t
    u.uAngio.value = a.angio
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
    const [pos, look] = CAMERA_PRESETS[selected]
    camTarget.current = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) }
  }, [selected, view])

  // guided tour / explicit focus requests
  useEffect(() => {
    if (!props.focus) return
    const [pos, look] = CAMERA_PRESETS[props.focus]
    camTarget.current = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) }
  }, [props.focus, props.focusKey])

  // the cross-section needs local clipping enabled on the renderer
  useEffect(() => { gl.localClippingEnabled = true }, [gl])

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
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} autoRotate={!!props.autoRotate} autoRotateSpeed={1.3} minDistance={1.4} maxDistance={14} />
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
        {centerlines && flow && lift < 0.05 && <FlowParticles centerlines={centerlines} risks={risks} />}
        {labels && view === 'heart' && VESSELS.map((v) => anchors[v] && (
          <Html key={v} position={anchors[v]!.clone().addScaledVector(setup.liftDir[v] ?? new THREE.Vector3(), lift * 0.32)} center zIndexRange={[20, 0]}>
            <button className={`vlabel ${selected === v ? 'is-sel' : ''}`} style={{ ['--c' as any]: '#' + riskColor(risks[v]).getHexString() }}
              onClick={(e) => { e.stopPropagation(); onSelect(selected === v ? null : v) }} aria-label={`${v} ${Math.round(risks[v] * 100)} percent, show details`}>
              <b>{v}</b><span>{Math.round(risks[v] * 100)}%</span>
            </button>
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
