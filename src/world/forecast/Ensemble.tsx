import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useStore } from '../../store'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { L96_N, MAX_MEMBERS } from './lorenz96'
import { CROWN_VERTICES, CrownRing, siteAngle } from './crown'
import { advanceForecast, createForecastSim, writeForecastCrowns, type ForecastSim } from './sim'

/**
 * The ensemble forecast: Lorenz-96 weather on a ring of 40 stations, the truth and up to 64
 * copies started a hair apart, drawn as wavy crowns around a faint dial. The members begin as
 * one bright band and fray into a cloud; the spread of that cloud is the forecast.
 *
 * Local frame: the dial lies in the XZ plane at y = 0, radius `radius`; crowns rise with x
 * (see crown.ts). All lines are additive and drawn without depth test, in this order: dial,
 * members, ensemble mean, truth.
 *
 * Reads `forecast` from the store every frame (no React state per frame) and writes the
 * `worldTele.forecast*` numbers and series. A change of `resetSerial` starts new weather; a
 * change of `members` or `perturbation` restarts the same weather with the new ensemble.
 *
 * The clock, restarts, telemetry and the blend between 6-hour steps live in sim.ts.
 */

export const ENSEMBLE_RADIUS = 1.1

const INK = '#efe8dc'
const MEAN_COLOR = '#ffb07a'
/** palette t of the members' violet (house speedColor ramp) */
const MEMBER_TONE = 0.35
/** per member; 50 coincident members sum to ≈ 9× this */
const MEMBER_INTENSITY = 0.18
const TRUTH_INTENSITY = 0.9
const MEAN_INTENSITY = 0.7
const MEMBER_PX = 1
const TRUTH_PX = 2
const MEAN_PX = 1.5
const DIAL_PX = 1
const DIAL_RING_INTENSITY = 0.12
const TICK_INTENSITY = 0.2
/** radial ticks reach this far either side of the dial */
const TICK_HALF = 0.035

const DIAL_SEGMENTS = CROWN_VERTICES + L96_N

const noRaycast = () => {}

export interface EnsembleProps {
  /** radius of the dial (x = 0) in local units. Default ENSEMBLE_RADIUS */
  radius?: number
}

/** The house speedColor ramp (src/scene/palette.ts) on the CPU, in linear RGB like the shaders use it. */
function speedColor(t: number, out: THREE.Color): THREE.Color {
  const ss = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)
  }
  const ramp = [
    [0.043, 0.114, 0.42],
    [0.302, 0.247, 0.839],
    [0.914, 0.416, 0.627],
    [1.0, 0.941, 0.784],
  ]
  const w = [ss(0, 0.35, t), ss(0.35, 0.68, t), ss(0.68, 1, t)]
  const c = ramp[0].slice()
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[j] += (ramp[i + 1][j] - c[j]) * w[i]
  return out.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace)
}

function makeMaterial(px: number, color: THREE.Color | null, opacity: number): LineMaterial {
  const m = createTrajectoryLineMaterial(px)
  if (color) {
    m.vertexColors = false
    m.color.copy(color)
  }
  m.opacity = opacity
  return m
}

/** A LineSegments2 with room for `segments` segments whose positions are rewritten in place. */
function makeSegments(segments: number, material: LineMaterial, renderOrder: number, withColors = false) {
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(new Float32Array(segments * 6))
  if (withColors) geometry.setColors(new Float32Array(segments * 6))
  const start = geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
  const buffer = start.data.setUsage(THREE.DynamicDrawUsage)
  const line = new LineSegments2(geometry, material)
  line.frustumCulled = false
  line.raycast = noRaycast
  line.renderOrder = renderOrder
  line.visible = false
  return { line, geometry, buffer, array: buffer.array as Float32Array }
}

function createRig() {
  const violet = speedColor(MEMBER_TONE, new THREE.Color())
  const dialMaterial = makeMaterial(DIAL_PX, null, 1)
  const memberMaterial = makeMaterial(MEMBER_PX, violet, MEMBER_INTENSITY)
  const meanMaterial = makeMaterial(MEAN_PX, new THREE.Color(MEAN_COLOR), MEAN_INTENSITY)
  const truthMaterial = makeMaterial(TRUTH_PX, new THREE.Color(INK), TRUTH_INTENSITY)

  const dial = makeSegments(DIAL_SEGMENTS, dialMaterial, 0, true)
  const members = makeSegments(MAX_MEMBERS * CROWN_VERTICES, memberMaterial, 1)
  const mean = makeSegments(CROWN_VERTICES, meanMaterial, 2)
  const truth = makeSegments(CROWN_VERTICES, truthMaterial, 3)

  // the dial's colours never change: the ring, then the ticks
  const ink = new THREE.Color(INK)
  const colorStart = dial.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute
  const col = colorStart.data.array as Float32Array
  for (let s = 0; s < DIAL_SEGMENTS; s++) {
    const k = s < CROWN_VERTICES ? DIAL_RING_INTENSITY : TICK_INTENSITY
    for (let e = 0; e < 2; e++) {
      col[s * 6 + e * 3] = ink.r * k
      col[s * 6 + e * 3 + 1] = ink.g * k
      col[s * 6 + e * 3 + 2] = ink.b * k
    }
  }
  colorStart.data.needsUpdate = true

  const root = new THREE.Group()
  root.name = 'Ensemble'
  root.add(dial.line, members.line, mean.line, truth.line)

  const materials = [dialMaterial, memberMaterial, meanMaterial, truthMaterial]
  return {
    root,
    dial,
    members,
    mean,
    truth,
    materials,
    dispose() {
      for (const s of [dial, members, mean, truth]) s.geometry.dispose()
      for (const m of materials) m.dispose()
    },
  }
}

type Rig = ReturnType<typeof createRig>

/** The flat dial: the circle the crowns stand on (x = 0) and a radial tick at every station. */
function writeDial(rig: Rig, ring: CrownRing) {
  const a = rig.dial.array
  const base = ring.base
  const radius = ring.radius
  let o = 0
  for (let k = 0; k < CROWN_VERTICES; k++) {
    const n = k + 1 === CROWN_VERTICES ? 0 : k + 1
    a[o] = base[2 * k]
    a[o + 1] = 0
    a[o + 2] = base[2 * k + 1]
    a[o + 3] = base[2 * n]
    a[o + 4] = 0
    a[o + 5] = base[2 * n + 1]
    o += 6
  }
  for (let i = 0; i < L96_N; i++) {
    const c = Math.cos(siteAngle(i))
    const s = -Math.sin(siteAngle(i))
    a[o] = (radius - TICK_HALF) * c
    a[o + 1] = 0
    a[o + 2] = (radius - TICK_HALF) * s
    a[o + 3] = (radius + TICK_HALF) * c
    a[o + 4] = 0
    a[o + 5] = (radius + TICK_HALF) * s
    o += 6
  }
  rig.dial.buffer.needsUpdate = true
  rig.dial.line.visible = true
}

function writeCrowns(rig: Rig, sim: ForecastSim, ring: CrownRing) {
  const m = writeForecastCrowns(sim, ring, rig.members.array, rig.mean.array, rig.truth.array)
  rig.members.geometry.instanceCount = m * CROWN_VERTICES
  rig.members.buffer.needsUpdate = true
  rig.members.line.visible = m > 0
  rig.mean.buffer.needsUpdate = true
  rig.mean.line.visible = m > 0
  rig.truth.buffer.needsUpdate = true
  rig.truth.line.visible = true
}

export function Ensemble({ radius = ENSEMBLE_RADIUS }: EnsembleProps) {
  const live = useRef({ radius })
  live.current.radius = radius
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const [sim] = useState(createForecastSim)
  // the dial radius and pixel ratio the buffers and materials were last set up for
  const [ring] = useState(() => new CrownRing(radius))
  const [seen] = useState(() => ({ radius: NaN, dpr: NaN }))

  useFrame((state, delta) => {
    let dirty = advanceForecast(sim, useStore.getState().forecast, delta)
    // compare before calling anything: doubles handed to functions are boxed, and this is every frame
    if (live.current.radius !== seen.radius) {
      seen.radius = live.current.radius
      ring.setRadius(seen.radius)
      writeDial(rig, ring)
      dirty = true
    }
    if (dirty) writeCrowns(rig, sim, ring)

    // LineSegments2 sets each material's resolution from the viewport itself before drawing;
    // the AA fringe follows the pixel ratio, so it is set when that changes
    if (state.viewport.dpr !== seen.dpr) {
      seen.dpr = state.viewport.dpr
      const mats = rig.materials
      for (let i = 0; i < mats.length; i++) setLinePixelRatio(mats[i], seen.dpr)
    }
  })

  return <primitive object={rig.root} />
}
