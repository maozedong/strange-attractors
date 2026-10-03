import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { worldTele } from '../telemetry'
import { TaffySim } from './TaffySim'
import { BOUNDARY_RADIUS, ROD_FRAME, ROD_STRIDE, SUBSTEPS_PER_PULL, rodFrame, rodKinematics } from './puller'
import { taffyOverlayFrag, taffyOverlayVert, taffyPointsFrag, taffyPointsVert } from './shaders'

/** Width of the whole puller (the boundary circle's diameter) in domain units; the default `size`. */
export const TAFFY_SIZE = 2 * BOUNDARY_RADIUS

/**
 * Set when the GPU simulation cannot be created (no WebGL 2, no float render targets, shader
 * compile failure). The UI can poll it and show a fallback; the stage then renders nothing.
 */
export const taffyPullerStatus = { error: null as Error | null }

/** 512² = 262,144 points */
const SIM_SIZE = 512
const DEFAULT_GAIN = 0.08
/** point diameter, CSS px */
const DEFAULT_POINT_SIZE = 1.6
/** substeps one frame may run (8 covers 1 pull/s down to 12 fps); any backlog beyond is dropped */
const MAX_STEPS_PER_FRAME = 8
/** longest frame step fed to the clock (a background tab must not dump a backlog of pulls) */
const MAX_DT = 0.1
const INK = '#efe8dc'
/** the overlay plane reaches a little past the boundary circle */
const OVERLAY_HALF = BOUNDARY_RADIUS + 0.04

export interface TaffyPullerProps {
  /** width of the whole puller (boundary circle diameter), local units. Default TAFFY_SIZE (2.4) */
  size?: number
  /** 0..1, fades everything; at 0 the pulling also holds still. Default 1 */
  opacity?: number
  /** brightness of one point at the reference density (REF_PX_PER_UNIT). Default 0.08 */
  gain?: number
  /** point diameter, CSS px. Default 1.6 */
  pointSize?: number
}

const additive = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const

function createPointUniforms() {
  return {
    uCur: { value: null as THREE.Texture | null },
    uPrev: { value: null as THREE.Texture | null },
    uPhase: { value: 1 },
    uGain: { value: DEFAULT_GAIN },
    uOpacity: { value: 1 },
    uPointSize: { value: DEFAULT_POINT_SIZE },
    uViewportH: { value: 1 },
  }
}

function createOverlayUniforms() {
  return {
    uRods: { value: Array.from({ length: 3 }, () => new THREE.Vector2()) },
    uInk: { value: new THREE.Color(INK) },
    uOpacity: { value: 1 },
    uBoundary: { value: BOUNDARY_RADIUS },
    uDpr: { value: 1 },
  }
}

/** Everything one mounted puller owns, plus the small state its frame loop keeps. */
interface Rig {
  sim: TaffySim
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  uniforms: ReturnType<typeof createPointUniforms>
  overlayGeometry: THREE.PlaneGeometry
  overlayMaterial: THREE.ShaderMaterial
  overlayUniforms: ReturnType<typeof createOverlayUniforms>
  appliedReset: number
  /** substeps run since the last reset */
  substeps: number
  /** substeps owed, as a fraction of one: also the phase of the substep being shown */
  carry: number
  /** rod frames for a substep's start, midpoint and end; rods at the shown time */
  f0: Float64Array
  fm: Float64Array
  f1: Float64Array
  shownRods: Float64Array
  /** set by `webglcontextrestored`: GPU state was wiped, lay fresh taffy on the next frame */
  contextRestored: boolean
}

/** The latest props, for frame loops that must not re-subscribe when they change. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

const noRaycast = () => {}

/**
 * The taffy puller: a 2-D blob of taffy (262,144 points, warm on the left half, cool on the
 * right) kneaded by three rods (see puller.ts for the braid and the fluid), in the group's
 * local XY plane facing +Z, centred on the origin. `taffy.speed` pulls per second while
 * `taffy.running`; bumping `taffy.resetSerial` lays fresh taffy. Points are drawn between
 * substeps and the rods at the same in-between time, so slow pulls stay smooth. Reads the store
 * every frame; never re-renders for it. Writes `worldTele.taffyPulls`.
 */
export function TaffyPuller({
  size = TAFFY_SIZE,
  opacity = 1,
  gain = DEFAULT_GAIN,
  pointSize = DEFAULT_POINT_SIZE,
}: TaffyPullerProps) {
  const gl = useThree((s) => s.gl)
  const live = useLatest({ opacity, gain, pointSize })
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const groupRef = useRef<THREE.Group>(null)

  useEffect(() => {
    let sim: TaffySim
    try {
      sim = new TaffySim(gl, SIM_SIZE)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      taffyPullerStatus.error = err
      console.error('[TaffyPuller] GPU simulation unavailable:', err)
      return
    }
    taffyPullerStatus.error = null

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', sim.positionAttribute)
    geometry.setAttribute('ref', sim.refAttribute)
    // positions live in a texture; nothing should compute bounds from the zeros
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)

    const uniforms = createPointUniforms()
    const material = new THREE.ShaderMaterial({
      name: 'TaffyPuller.points',
      vertexShader: taffyPointsVert,
      fragmentShader: taffyPointsFrag,
      uniforms,
      ...additive,
    })

    const overlayGeometry = new THREE.PlaneGeometry(2 * OVERLAY_HALF, 2 * OVERLAY_HALF)
    const overlayUniforms = createOverlayUniforms()
    const overlayMaterial = new THREE.ShaderMaterial({
      name: 'TaffyPuller.rods',
      vertexShader: taffyOverlayVert,
      fragmentShader: taffyOverlayFrag,
      uniforms: overlayUniforms,
      ...additive,
    })

    const next: Rig = {
      sim,
      geometry,
      material,
      uniforms,
      overlayGeometry,
      overlayMaterial,
      overlayUniforms,
      appliedReset: Number.NaN,
      substeps: 0,
      carry: 0,
      f0: new Float64Array(ROD_FRAME),
      fm: new Float64Array(ROD_FRAME),
      f1: new Float64Array(ROD_FRAME),
      shownRods: new Float64Array(ROD_FRAME),
      contextRestored: false,
    }
    uniforms.uCur.value = sim.texture
    uniforms.uPrev.value = sim.previousTexture

    const canvas = gl.domElement
    const onRestored = () => {
      next.contextRestored = true
    }
    canvas.addEventListener('webglcontextrestored', onRestored)

    rigRef.current = next
    setRig(next)

    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      geometry.dispose()
      material.dispose()
      overlayGeometry.dispose()
      overlayMaterial.dispose()
      sim.dispose()
      setRig(null)
    }
  }, [gl])

  useFrame((state, delta) => {
    const r = rigRef.current
    if (!r) return
    const { sim, uniforms: u, overlayUniforms: o } = r
    const p = live.current
    const { running, speed, resetSerial } = useStore.getState().taffy
    const dt = Math.min(Math.max(delta, 0), MAX_DT)

    // 1. fresh taffy on mount, on a reset, and after a lost context
    if (resetSerial !== r.appliedReset || r.contextRestored) {
      r.contextRestored = false
      r.appliedReset = resetSerial
      sim.reset()
      r.substeps = 0
      r.carry = 0
    }

    // 2. pull. A hidden puller holds still rather than pulling unseen.
    const rate = running && Number.isFinite(speed) && speed > 0 ? speed * SUBSTEPS_PER_PULL : 0
    if (rate > 0 && p.opacity > 0) {
      r.carry += rate * dt
      const owed = Math.floor(r.carry)
      if (owed > 0) {
        const steps = Math.min(owed, MAX_STEPS_PER_FRAME)
        for (let i = 0; i < steps; i++) {
          const n = r.substeps
          rodFrame(n / SUBSTEPS_PER_PULL, r.f0)
          rodFrame((n + 0.5) / SUBSTEPS_PER_PULL, r.fm)
          rodFrame((n + 1) / SUBSTEPS_PER_PULL, r.f1)
          sim.step(r.f0, r.fm, r.f1, 1 / SUBSTEPS_PER_PULL)
          r.substeps = n + 1
        }
        // drop any backlog beyond the cap; keep the phase of the substep now in flight
        r.carry -= owed
      }
    }

    // 3. what is shown: `phase` of the way from the previous substep to the current one.
    // Before the first substep both states are the fresh taffy, at time 0.
    const phase = r.substeps > 0 ? Math.min(Math.max(r.carry, 0), 1) : 1
    const shown = r.substeps > 0 ? (r.substeps - 1 + phase) / SUBSTEPS_PER_PULL : 0
    worldTele.taffyPulls = shown
    rodKinematics(shown, r.shownRods)
    for (let k = 0; k < 3; k++) o.uRods.value[k].set(r.shownRods[k * ROD_STRIDE], r.shownRods[k * ROD_STRIDE + 1])

    // 4. render uniforms
    const dpr = state.gl.getPixelRatio()
    u.uCur.value = sim.texture
    u.uPrev.value = sim.previousTexture
    u.uPhase.value = phase
    u.uGain.value = p.gain * ((SIM_SIZE * SIM_SIZE) / sim.count)
    u.uOpacity.value = p.opacity
    u.uPointSize.value = p.pointSize * dpr
    u.uViewportH.value = state.size.height
    o.uOpacity.value = p.opacity
    o.uDpr.value = dpr
    if (groupRef.current) groupRef.current.visible = p.opacity > 0
  })

  if (!rig) return null
  const scale = size / TAFFY_SIZE
  return (
    <group ref={groupRef} scale={scale}>
      <points
        geometry={rig.geometry}
        material={rig.material}
        frustumCulled={false}
        // positions live in a texture, so CPU raycasts would only see zeros
        raycast={noRaycast}
      />
      <mesh geometry={rig.overlayGeometry} material={rig.overlayMaterial} raycast={noRaycast} renderOrder={1} />
    </group>
  )
}
