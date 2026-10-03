import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { SYSTEMS, getSystem, systemIndex } from '../systems'
import type { SystemId } from '../types'
import { SwarmSim } from '../sim/SwarmSim'
import { MAX_PARAMS, buildDerivGlsl } from '../sim/shaders/step'
import { buildStreakVert, streakFrag } from '../sim/shaders/streaks'
import { queueSteps, tele } from '../sim/telemetry'

/**
 * Set when the GPU simulation cannot be created (no WebGL 2, no float render targets,
 * shader compile failure). The UI polls it and shows a fallback; the scene renders nothing.
 */
export const swarmStatus = { error: null as Error | null }

let currentSim: SwarmSim | null = null
/** The live simulation, for debugging from the console or other modules. */
export function getSwarmSim(): SwarmSim | null {
  return currentSim
}

/** streak width in CSS pixels */
const DEFAULT_WIDTH = 1.5
/** brightness of one streak; a few overlapping streaks reach white */
const DEFAULT_GAIN = 0.035
/**
 * Streak length, in render units, for a particle moving at the system's `speedNorm`
 * (about the 95th percentile). Normalising by speed gives every attractor the same
 * long-exposure look whatever its natural time scale.
 */
const STREAK = 0.03
/** shortest / longest streak, CSS pixels */
const MIN_LEN = 2
const MAX_LEN = 28
/** Exponential approach rate (1/s) for the colour-mode cross-fade and opacity fades. */
const FADE_RATE = 4
/**
 * On a system switch the remapped particles are off the new attractor; this many seconds
 * of the new system's motion (at its own rate) are played over ~0.8 s so they visibly
 * rush onto the new shape instead of drifting in for a minute.
 */
const SWITCH_WHOOSH_SECONDS = 6
const SWITCH_WHOOSH_FRAMES = 48
const SIM_SIZES = [256, 512, 1024]

export interface SwarmProps {
  /** Streak width in CSS pixels. Default 1.5 */
  width?: number
  /** Brightness of a single streak. Default 0.035 */
  gain?: number
}

function createUniforms() {
  return {
    uPos: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector3() },
    uScale: { value: 1 },
    uSpeedNorm: { value: 1 },
    uColorMode: { value: 0 },
    uOpacity: { value: 1 },
    uGain: { value: DEFAULT_GAIN },
    uWidth: { value: DEFAULT_WIDTH },
    uExposure: { value: 0.03 },
    uMinLen: { value: MIN_LEN },
    uMaxLen: { value: MAX_LEN },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSystem: { value: 0 },
    P: { value: new Float32Array(MAX_PARAMS) },
    uMirror: { value: 0 },
    uFloorY: { value: FLOOR_Y },
  }
}

/** world y of the reflective floor the swarm stands on */
export const FLOOR_Y = -1.25

/** Everything one mounted swarm owns, plus the small amount of state the frame loop keeps. */
interface Rig {
  sim: SwarmSim
  geometry: THREE.InstancedBufferGeometry
  hueAttribute: THREE.InstancedBufferAttribute
  material: THREE.ShaderMaterial
  /** same shader, same uniform holders, except uMirror = 1 */
  mirrorMaterial: THREE.ShaderMaterial
  uniforms: ReturnType<typeof createUniforms>
  /** system + params currently loaded into the sim (compared every frame, no allocation) */
  appliedId: SystemId | null
  appliedParams: Float64Array
  appliedCount: number
  /** smoothed values driving uColorMode / uOpacity / uGain */
  colorMode: number
  opacity: number
  gain: number
  /** set by `webglcontextrestored`: GPU state was wiped, respawn on the next frame */
  contextRestored: boolean
}

/** 512² by default, 256² on phones and ≤4-core machines, `?n=256|512|1024` overrides. */
function chooseSimSize(): number {
  const n = Number(new URLSearchParams(window.location.search).get('n'))
  if (SIM_SIZES.includes(n)) return n
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const mobile =
    nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)
  const lowCore = nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4
  return mobile || lowCore ? 256 : 512
}

/** Load system + params into the sim and the render transform; remember what was loaded. */
function applySystem(rig: Rig, id: SystemId, params: number[], newSystem: boolean): void {
  const sys = getSystem(id)
  const index = systemIndex(id)
  if (newSystem) rig.sim.setSystem(index, sys, params)
  else rig.sim.setParams(sys, params)

  const u = rig.uniforms
  const frame = sys.frame(params)
  u.uCenter.value.fromArray(frame.center)
  u.uScale.value = frame.scale
  u.uSpeedNorm.value = sys.speedNorm(params)
  u.uSystem.value = index
  u.P.value.fill(0)
  for (let i = 0; i < Math.min(params.length, MAX_PARAMS); i++) u.P.value[i] = params[i]

  rig.appliedId = id
  rig.appliedCount = Math.min(params.length, MAX_PARAMS)
  for (let i = 0; i < rig.appliedCount; i++) rig.appliedParams[i] = params[i]
}

function paramsMatch(rig: Rig, params: number[]): boolean {
  if (params.length !== rig.appliedCount) return false
  for (let i = 0; i < params.length; i++) if (params[i] !== rig.appliedParams[i]) return false
  return true
}

/**
 * Time since spawn of the state that will be on screen this frame. SimClock already counted
 * this frame's steps, and the step below runs them on the new particles, so that is
 * steps * dt (exactly 0 while paused).
 */
function resetSimTime(): void {
  tele.simTime = tele.stepsThisFrame * tele.dt
}

function approach(x: number, target: number, dt: number): number {
  const v = THREE.MathUtils.damp(x, target, FADE_RATE, dt)
  return Math.abs(target - v) < 1e-3 ? target : v
}

const noRaycast = () => {}

/**
 * The GPU particle swarm, drawn as motion-blur streaks. Mount once inside the Canvas,
 * after <SimClock />. Reads commands and settings from the store each frame; never
 * re-renders for them.
 */
export function Swarm({ width = DEFAULT_WIDTH, gain = DEFAULT_GAIN }: SwarmProps) {
  const gl = useThree((s) => s.gl)
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const mirrorRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    let sim: SwarmSim
    try {
      sim = new SwarmSim(gl, chooseSimSize())
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      swarmStatus.error = err
      console.error('[Swarm] GPU simulation unavailable:', err)
      return
    }
    swarmStatus.error = null

    const uniforms = createUniforms()

    // one quad per particle: position.x = end (0 head, 1 tail), position.y = side (±1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3),
    )
    geometry.setIndex([0, 2, 1, 1, 2, 3])
    geometry.setAttribute('ref', new THREE.InstancedBufferAttribute(sim.refAttribute.array as Float32Array, 2))
    const hueAttribute = new THREE.InstancedBufferAttribute(sim.hueAttribute.array as Float32Array, 1)
    geometry.setAttribute('aHue', hueAttribute)
    geometry.instanceCount = sim.count
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

    const material = new THREE.ShaderMaterial({
      name: 'Swarm.streaks',
      vertexShader: buildStreakVert(buildDerivGlsl(SYSTEMS)),
      fragmentShader: streakFrag,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      // Additive in colour, like AdditiveBlending, but destination alpha is left alone.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })

    // the reflection shares every uniform holder with the main material except uMirror
    const mirrorMaterial = material.clone()
    mirrorMaterial.uniforms = { ...uniforms, uMirror: { value: 1 } }

    const s = useStore.getState()
    const next: Rig = {
      sim,
      geometry,
      hueAttribute,
      material,
      mirrorMaterial,
      uniforms,
      appliedId: null,
      appliedParams: new Float64Array(MAX_PARAMS),
      appliedCount: 0,
      colorMode: s.colorMode === 'origin' ? 1 : 0,
      opacity: s.swarmVisible ? s.swarmOpacity : 0,
      gain,
      contextRestored: false,
    }

    // start with the finished attractor so something is on screen from frame one
    applySystem(next, s.systemId, s.params, true)
    sim.spawnAttractor(getSystem(s.systemId), s.params)
    hueAttribute.needsUpdate = true
    tele.simTime = 0
    uniforms.uPos.value = sim.texture
    uniforms.uColorMode.value = next.colorMode
    uniforms.uOpacity.value = next.opacity

    const canvas = gl.domElement
    const onRestored = () => {
      next.contextRestored = true
    }
    canvas.addEventListener('webglcontextrestored', onRestored)

    currentSim = sim
    rigRef.current = next
    setRig(next)

    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      if (currentSim === sim) currentSim = null
      geometry.dispose()
      material.dispose()
      mirrorMaterial.dispose()
      sim.dispose()
      setRig(null)
    }
  }, [gl])

  useFrame((state, delta) => {
    const r = rigRef.current
    if (!r) return
    const { sim, uniforms: u } = r

    // 1. commands, in order
    const queue = useStore.getState().drainSwarm()
    const { systemId, params, colorMode, swarmVisible, swarmOpacity } = useStore.getState()
    const sys = getSystem(systemId)
    let speedsStale = false

    if (r.contextRestored) {
      // the context loss wiped both state targets; start over on the attractor
      r.contextRestored = false
      applySystem(r, systemId, params, true)
      sim.spawnAttractor(sys, params)
      r.hueAttribute.needsUpdate = true
      resetSimTime()
    }

    for (let i = 0; i < queue.length; i++) {
      const c = queue[i]
      switch (c.type) {
        case 'spawnCloud':
          sim.spawnCloud(c.center, c.radius)
          r.hueAttribute.needsUpdate = true
          resetSimTime()
          break
        case 'spawnAttractor':
          sim.spawnAttractor(sys, params)
          r.hueAttribute.needsUpdate = true
          resetSimTime()
          break
        case 'switchSystem':
          sim.remap(c.from, c.to)
          applySystem(r, systemId, params, true)
          queueSteps(Math.round((SWITCH_WHOOSH_SECONDS * sys.rate) / sys.dt), SWITCH_WHOOSH_FRAMES)
          speedsStale = true
          break
      }
    }

    // 2. follow system / param edits made outside the command queue (sliders, resets)
    if (systemId !== r.appliedId) {
      applySystem(r, systemId, params, true)
      speedsStale = true
    } else if (!paramsMatch(r, params)) {
      applySystem(r, systemId, params, false)
      speedsStale = true
    }

    // 3. integrate. With no steps (paused) still refresh speeds after a change so colours follow.
    const steps = tele.stepsThisFrame
    if (steps > 0) sim.step(tele.dt, steps, state.clock.elapsedTime)
    else if (speedsStale) sim.refreshSpeed()

    // 4. render uniforms
    const dpr = state.gl.getPixelRatio()
    r.colorMode = approach(r.colorMode, colorMode === 'origin' ? 1 : 0, delta)
    r.opacity = approach(r.opacity, swarmVisible ? swarmOpacity : 0, delta)
    r.gain = approach(r.gain, gain, delta)
    u.uPos.value = sim.texture
    u.uColorMode.value = r.colorMode
    u.uOpacity.value = r.opacity
    u.uGain.value = r.gain
    u.uWidth.value = width * dpr
    u.uMinLen.value = MIN_LEN * dpr
    u.uMaxLen.value = MAX_LEN * dpr
    // exposure in system time such that a p95-speed particle leaves a STREAK-long trail
    const frame = sys.frame(params)
    u.uExposure.value = STREAK / Math.max(1e-6, sys.speedNorm(params) * frame.scale)
    u.uResolution.value.set(state.size.width * dpr, state.size.height * dpr)
    if (meshRef.current) meshRef.current.visible = r.opacity > 0
    if (mirrorRef.current) mirrorRef.current.visible = r.opacity > 0
  }, 0)

  if (!rig) return null
  return (
    // the systems use z as "up"; three uses y
    <group rotation-x={-Math.PI / 2}>
      <mesh
        ref={meshRef}
        geometry={rig.geometry}
        material={rig.material}
        frustumCulled={false}
        // positions live in a texture, so CPU raycasts would only see the quad template
        raycast={noRaycast}
      />
      <mesh ref={mirrorRef} geometry={rig.geometry} material={rig.mirrorMaterial} frustumCulled={false} raycast={noRaycast} />
    </group>
  )
}
