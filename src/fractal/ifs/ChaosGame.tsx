import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import type { IfsPreset } from '../types'
import { IfsSim } from './IfsSim'
import { chaosPointsFrag, chaosPointsVert } from './shaders'
import {
  IFS_PRESETS,
  MAP_COUNT_MAX,
  createIfsUniforms,
  presetUniforms,
  stageFrame,
  type IfsFrame,
  type IfsUniforms,
} from './presets'

export const PRESET_LABELS: Record<IfsPreset, string> = {
  sierpinski: "Sierpinski's triangle",
  fern: "Barnsley's fern",
  dragon: 'The dragon',
  leaf: 'A maple leaf',
  spiral: 'A spiral',
}

/**
 * Set when the GPU chaos game cannot be created (no WebGL 2, no float render targets, shader
 * compile failure). The UI can poll it and show a fallback; the stage then renders nothing.
 */
export const chaosGameStatus = { error: null as Error | null }

/** 512² = 262,144 points */
const SIM_SIZE = 512
/** brightness of one point at the reference density (REF_PX_PER_STAGE in shaders.ts) */
const DEFAULT_GAIN = 0.08
/** point diameter, CSS px */
const DEFAULT_POINT_SIZE = 1.8
/** seconds the frame takes to follow a preset change */
const FRAME_TWEEN = 1.2
const MAX_STEPS_PER_FRAME = 4
/** at or above this rate the points are drawn where they are, with no in-between */
const SNAP_RATE = 30
/** below this rate each step eases in and out; by EASE_LINEAR_RATE it is a straight glide */
const EASE_FULL_RATE = 2
const EASE_LINEAR_RATE = 10
/** the frame's limiting side fills this share of the plane */
const FIT_MARGIN = 0.92
/** longest frame step fed to the clock (a background tab must not dump a backlog of steps) */
const MAX_DT = 0.1

export interface ChaosGameProps {
  /** plane width, local units */
  width: number
  /** plane height, local units */
  height: number
  /** 0..1, fades everything. Default 1 */
  opacity?: number
  /** brightness of one point at the reference density. Default 0.08 */
  gain?: number
  /** point diameter, CSS px. Default 1.8 */
  pointSize?: number
}

function createUniforms() {
  return {
    uCur: { value: null as THREE.Texture | null },
    uPrev: { value: null as THREE.Texture | null },
    uPhase: { value: 1 },
    uMotion: { value: identityMotion() },
    uCenter: { value: new THREE.Vector2() },
    uFit: { value: 1 },
    uGain: { value: DEFAULT_GAIN },
    uOpacity: { value: 1 },
    uPointSize: { value: DEFAULT_POINT_SIZE },
    uViewportH: { value: 1 },
  }
}

function identityMotion(): Float32Array {
  const m = new Float32Array(8 * MAP_COUNT_MAX)
  for (let i = 0; i < MAP_COUNT_MAX; i++) {
    m[i * 8 + 4] = 1
    m[i * 8 + 6] = 1
  }
  return m
}

/** Everything one mounted chaos game owns, plus the small state its frame loop keeps. */
interface Rig {
  sim: IfsSim
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  uniforms: ReturnType<typeof createUniforms>
  /** maps for the store's preset and variation; the sim already has them */
  maps: IfsUniforms
  appliedPreset: IfsPreset | null
  appliedVariation: number
  appliedReset: number
  /** iterations owed, as a fraction of one: also the phase of the step in flight */
  carry: number
  /** the last step ran at SNAP_RATE or above: draw at phase 1 until the next one */
  snapped: boolean
  /** frame tween (stage units) and the per-preset gain riding along with it */
  from: IfsFrame
  to: IfsFrame
  frame: IfsFrame
  tweenTime: number
  gainFrom: number
  gainTo: number
  presetGain: number
  /** scratch for scatters */
  scatterFrame: IfsFrame
  /** set by `webglcontextrestored`: GPU state was wiped, scatter again on the next frame */
  contextRestored: boolean
}

function copyFrame(dst: IfsFrame, src: IfsFrame): IfsFrame {
  dst.cx = src.cx
  dst.cy = src.cy
  dst.halfW = src.halfW
  dst.halfH = src.halfH
  return dst
}

/** Local units per stage unit that fit `frame` inside a width × height plane. */
function fitScale(frame: IfsFrame, width: number, height: number): number {
  const s = FIT_MARGIN * Math.min(width / (2 * frame.halfW), height / (2 * frame.halfH))
  return s > 0 && Number.isFinite(s) ? s : 1
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

function smoothstep01(u: number): number {
  return u * u * (3 - 2 * u)
}

/** The latest props, for frame loops that must not re-subscribe when they change. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

const noRaycast = () => {}

/**
 * The chaos game: 262,144 points in the group's local XY plane (facing +Z; the parent
 * positions the group), each moved by one randomly chosen map of `ifs.preset` per iteration,
 * `ifs.rate` iterations per second. Starts as a uniform cloud over the plane; bumping
 * `ifs.resetSerial` scatters it again. A preset or variation change only swaps the maps, so the
 * cloud folds into the new shape. Reads the store every frame; never re-renders for it.
 */
export function ChaosGame({ width, height, opacity = 1, gain = DEFAULT_GAIN, pointSize = DEFAULT_POINT_SIZE }: ChaosGameProps) {
  const gl = useThree((s) => s.gl)
  const live = useLatest({ width, height, opacity, gain, pointSize })
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const pointsRef = useRef<THREE.Points>(null)

  useEffect(() => {
    let sim: IfsSim
    try {
      sim = new IfsSim(gl, SIM_SIZE)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      chaosGameStatus.error = err
      console.error('[ChaosGame] GPU simulation unavailable:', err)
      return
    }
    chaosGameStatus.error = null

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', sim.positionAttribute)
    geometry.setAttribute('ref', sim.refAttribute)
    // positions live in a texture; nothing should compute bounds from the zeros
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)

    const uniforms = createUniforms()
    const material = new THREE.ShaderMaterial({
      name: 'ChaosGame.points',
      vertexShader: chaosPointsVert,
      fragmentShader: chaosPointsFrag,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // additive in colour, destination alpha left alone (as the swarm does)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })

    const { preset } = useStore.getState().ifs
    const start = stageFrame(preset)
    const next: Rig = {
      sim,
      geometry,
      material,
      uniforms,
      maps: createIfsUniforms(),
      appliedPreset: null,
      appliedVariation: Number.NaN,
      appliedReset: Number.NaN,
      carry: 0,
      snapped: false,
      from: copyFrame({ ...start }, start),
      to: copyFrame({ ...start }, start),
      frame: copyFrame({ ...start }, start),
      tweenTime: FRAME_TWEEN,
      gainFrom: IFS_PRESETS[preset].gain,
      gainTo: IFS_PRESETS[preset].gain,
      presetGain: IFS_PRESETS[preset].gain,
      scatterFrame: { ...start },
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
      sim.dispose()
      setRig(null)
    }
  }, [gl])

  useFrame((state, delta) => {
    const r = rigRef.current
    if (!r) return
    const { sim, uniforms: u } = r
    const p = live.current
    const { preset, rate, variation, resetSerial } = useStore.getState().ifs
    const dt = Math.min(Math.max(delta, 0), MAX_DT)

    // 1. maps follow the store; a preset change also starts the frame tween
    const presetChanged = preset !== r.appliedPreset
    if (presetChanged || variation !== r.appliedVariation) {
      presetUniforms(preset, variation, r.maps)
      sim.setMaps(r.maps)
      if (presetChanged) {
        if (r.appliedPreset === null) {
          // first frame: start on the preset's frame, no tween
          stageFrame(preset, r.to)
          copyFrame(r.from, r.to)
          copyFrame(r.frame, r.to)
          r.tweenTime = FRAME_TWEEN
          r.gainFrom = r.gainTo = r.presetGain = IFS_PRESETS[preset].gain
        } else {
          copyFrame(r.from, r.frame)
          stageFrame(preset, r.to)
          r.tweenTime = 0
          r.gainFrom = r.presetGain
          r.gainTo = IFS_PRESETS[preset].gain
        }
      }
      r.appliedPreset = preset
      r.appliedVariation = variation
    }

    // 2. scatter on a reset, on mount, and after a lost context, over the whole plane
    if (resetSerial !== r.appliedReset || r.contextRestored) {
      r.contextRestored = false
      r.appliedReset = resetSerial
      const fit = fitScale(r.to, p.width, p.height)
      const sf = r.scatterFrame
      sf.cx = r.to.cx
      sf.cy = r.to.cy
      sf.halfW = p.width / 2 / fit
      sf.halfH = p.height / 2 / fit
      sim.scatter(sf)
      r.carry = 0
      r.snapped = false
    }

    // 3. iterate. A hidden game holds still rather than stepping unseen.
    const iterRate = Number.isFinite(rate) && rate > 0 ? rate : 0
    if (iterRate > 0 && p.opacity > 0) {
      r.carry += iterRate * dt
      const owed = Math.floor(r.carry)
      if (owed > 0) {
        const steps = Math.min(owed, MAX_STEPS_PER_FRAME)
        for (let i = 0; i < steps; i++) sim.step(state.clock.elapsedTime)
        // drop any backlog beyond the cap; keep the phase of the step now in flight
        r.carry -= owed
        // the renderer moves points by the maps these steps used
        u.uMotion.value.set(r.maps.motion)
        r.snapped = iterRate >= SNAP_RATE
      }
    }
    let phase = 1
    if (!r.snapped) {
      const c = Math.min(Math.max(r.carry, 0), 1)
      const linear = Math.min(Math.max((iterRate - EASE_FULL_RATE) / (EASE_LINEAR_RATE - EASE_FULL_RATE), 0), 1)
      phase = smoothstep01(c) + (c - smoothstep01(c)) * linear
    }

    // 4. frame tween
    if (r.tweenTime < FRAME_TWEEN) {
      r.tweenTime = Math.min(FRAME_TWEEN, r.tweenTime + dt)
      const e = easeInOutCubic(r.tweenTime / FRAME_TWEEN)
      r.frame.cx = r.from.cx + (r.to.cx - r.from.cx) * e
      r.frame.cy = r.from.cy + (r.to.cy - r.from.cy) * e
      r.frame.halfW = r.from.halfW + (r.to.halfW - r.from.halfW) * e
      r.frame.halfH = r.from.halfH + (r.to.halfH - r.from.halfH) * e
      r.presetGain = r.gainFrom + (r.gainTo - r.gainFrom) * e
    }

    // 5. render uniforms
    u.uCur.value = sim.texture
    u.uPrev.value = sim.previousTexture
    u.uPhase.value = phase
    u.uCenter.value.set(r.frame.cx, r.frame.cy)
    u.uFit.value = fitScale(r.frame, p.width, p.height)
    u.uGain.value = p.gain * r.presetGain * ((512 * 512) / sim.count)
    u.uOpacity.value = p.opacity
    u.uPointSize.value = p.pointSize * state.gl.getPixelRatio()
    u.uViewportH.value = state.size.height
    if (pointsRef.current) pointsRef.current.visible = p.opacity > 0
  })

  if (!rig) return null
  return (
    <points
      ref={pointsRef}
      geometry={rig.geometry}
      material={rig.material}
      frustumCulled={false}
      // positions live in a texture, so CPU raycasts would only see zeros
      raycast={noRaycast}
    />
  )
}
