import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { PendulumState } from '../../fractal/types'
import { createTrajectoryLineMaterial } from '../../scene/trajectories/lineMaterial'
import { DT, PendulumEnsemble, L1, L2, MAX_COPIES } from './physics'

/**
 * The double-pendulum stage without React: GPU objects (`createRig`), simulation state
 * (`createSim`) and the per-frame update (`advance`), so it runs and can be checked in Node.
 * Allocates nothing per frame.
 */

const INK = '#efe8dc'

/** simulated seconds per real second */
const SPEED = 1
/** longest real frame we integrate in full; slower frames run the pendulums in slow motion */
const MAX_FRAME = 1 / 20

/** trail samples per copy; one every TRAIL_EVERY steps (1/60 s), so the trail is 2.5 s long */
export const TRAIL_LEN = 150
export const TRAIL_EVERY = 12
/** trail brightness by age: (1 − age/TRAIL_LEN)^TRAIL_FADE, exactly 0 at the tail */
const TRAIL_FADE = 1.5

/** per-copy intensities (×N where copies overlap, which is the point) */
const ROD_GAIN = 0.25
const TRAIL_GAIN = 0.35
const TIP_GAIN = 1
const ELBOW_GAIN = 0.6
const RING_GAIN = 0.3

/** CSS pixels */
const ROD_WIDTH = 1.5
const TRAIL_WIDTH = 1
const RING_WIDTH = 1
const TIP_PX = 6
const ELBOW_PX = 4

/** 'auto' deck: spacing when side-on, and the sine of the view angle (camera forward vs the
 *  group's z axis) at which it starts opening and is fully open */
export const DECK_SPACING = 0.0015
export const DECK_CLOSED_BELOW = 0.2
export const DECK_OPEN_ABOVE = 0.75

const RING_RADIUS = 0.035
const RING_SEGMENTS = 48

export const noRaycast = () => {}

// ---------------------------------------------------------------- colour

/** The house speedColor ramp (scene/palette.ts paletteGlsl), same raw values. */
const RAMP = [
  [0.043, 0.114, 0.42],
  [0.302, 0.247, 0.839],
  [0.914, 0.416, 0.627],
  [1.0, 0.941, 0.784],
] as const
const RAMP_EDGES = [0, 0.35, 0.68, 1] as const

export function speedColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.max(0, Math.min(1, t))
  let r: number = RAMP[0][0]
  let g: number = RAMP[0][1]
  let b: number = RAMP[0][2]
  for (let i = 0; i < 3; i++) {
    const w = smoothstep(RAMP_EDGES[i], RAMP_EDGES[i + 1], x)
    r += (RAMP[i + 1][0] - r) * w
    g += (RAMP[i + 1][1] - g) * w
    b += (RAMP[i + 1][2] - b) * w
  }
  return out.setRGB(r, g, b, THREE.LinearSRGBColorSpace)
}

/** palette t of copy k of n */
const copyHue = (k: number, n: number) => 0.15 + 0.8 * (n > 1 ? k / (n - 1) : 0.5)

// ---------------------------------------------------------------- bobs

const bobVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uDpr;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uDpr;
}
`

const bobFrag = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  // a solid disc with a soft rim, so a 6 px bob stays round without MSAA
  float disc = 1.0 - smoothstep(0.5, 1.0, r);
  gl_FragColor = vec4(vColor * disc * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------- GPU objects

interface FatLines {
  line: LineSegments2
  material: LineMaterial
  /** CPU-side instance data for the most segments this set ever draws */
  pos: Float32Array
  col: Float32Array
  /** the GPU buffers, sized by `size` */
  posBuffer: THREE.InterleavedBuffer
  colBuffer: THREE.InterleavedBuffer
  /** segments the GPU buffers hold */
  capacity: number
}

function fatLines(maxSegments: number, linewidth: number, renderOrder: number): FatLines {
  const material = createTrajectoryLineMaterial(linewidth)
  const line = new LineSegments2(new LineSegmentsGeometry(), material)
  line.frustumCulled = false
  line.raycast = noRaycast
  line.renderOrder = renderOrder
  const f: FatLines = {
    line,
    material,
    pos: new Float32Array(maxSegments * 6),
    col: new Float32Array(maxSegments * 6),
    posBuffer: null!,
    colBuffer: null!,
    capacity: 0,
  }
  size(f, maxSegments)
  return f
}

/**
 * Point the GPU buffers at the first `segments` of the CPU arrays (a new geometry; only on a
 * count change). Whole-buffer uploads then send exactly what is drawn, without update ranges,
 * which allocate on every upload.
 */
function size(f: FatLines, segments: number) {
  if (segments === f.capacity) return
  const geometry = new LineSegmentsGeometry()
  geometry.setPositions(f.pos.subarray(0, segments * 6))
  geometry.setColors(f.col.subarray(0, segments * 6))
  f.posBuffer = (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
  f.colBuffer = (geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
  f.posBuffer.setUsage(THREE.DynamicDrawUsage)
  geometry.instanceCount = 0
  f.line.geometry.dispose()
  f.line.geometry = geometry
  f.capacity = segments
}

export function createRig() {
  const ink = new THREE.Color(INK)

  // trails, age-major: segment a·N + k joins copy k's point of age a to its point of age a + 1,
  // so every copy's first `filled` segments form one contiguous prefix of the buffer
  const trails = fatLines(MAX_COPIES * TRAIL_LEN, TRAIL_WIDTH, 1)

  // rods: segments 2k (pivot → elbow) and 2k + 1 (elbow → tip)
  const rods = fatLines(MAX_COPIES * 2, ROD_WIDTH, 2)
  for (let i = 0; i < MAX_COPIES * 2 * 2; i++) {
    rods.col[i * 3] = ink.r * ROD_GAIN
    rods.col[i * 3 + 1] = ink.g * ROD_GAIN
    rods.col[i * 3 + 2] = ink.b * ROD_GAIN
  }

  // pivot ring, static
  const ring = fatLines(RING_SEGMENTS, RING_WIDTH, 2)
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a0 = (i / RING_SEGMENTS) * Math.PI * 2
    const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
    ring.pos.set([RING_RADIUS * Math.cos(a0), RING_RADIUS * Math.sin(a0), 0, RING_RADIUS * Math.cos(a1), RING_RADIUS * Math.sin(a1), 0], i * 6)
    for (let j = 0; j < 2; j++) {
      ring.col[i * 6 + j * 3] = ink.r * RING_GAIN
      ring.col[i * 6 + j * 3 + 1] = ink.g * RING_GAIN
      ring.col[i * 6 + j * 3 + 2] = ink.b * RING_GAIN
    }
  }
  ring.line.geometry.instanceCount = RING_SEGMENTS

  // bobs: vertex 2k is copy k's elbow, 2k + 1 its tip
  const bobPositions = new Float32Array(MAX_COPIES * 2 * 3)
  const bobColors = new Float32Array(MAX_COPIES * 2 * 3)
  const bobSizes = new Float32Array(MAX_COPIES * 2)
  const bobGeometry = new THREE.BufferGeometry()
  const bobPosAttr = new THREE.BufferAttribute(bobPositions, 3).setUsage(THREE.DynamicDrawUsage)
  const bobColorAttr = new THREE.BufferAttribute(bobColors, 3)
  const bobSizeAttr = new THREE.BufferAttribute(bobSizes, 1)
  bobGeometry.setAttribute('position', bobPosAttr)
  bobGeometry.setAttribute('aColor', bobColorAttr)
  bobGeometry.setAttribute('aSize', bobSizeAttr)
  bobGeometry.setDrawRange(0, 0)
  const bobMaterial = new THREE.ShaderMaterial({
    name: 'DoublePendulums.bobs',
    vertexShader: bobVert,
    fragmentShader: bobFrag,
    uniforms: { uDpr: { value: 1 }, uOpacity: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })

  const lineMaterials = [trails.material, rods.material, ring.material]

  return {
    trails,
    rods,
    ring,
    bobGeometry,
    bobMaterial,
    bobPositions,
    bobColors,
    bobSizes,
    bobPosAttr,
    bobColorAttr,
    bobSizeAttr,
    lineMaterials,
    /** copy count the per-copy colours and the trail buffers were last built for */
    builtFor: 0,
    dispose() {
      for (const l of [trails, rods, ring]) {
        l.line.geometry.dispose()
        l.material.dispose()
      }
      bobGeometry.dispose()
      bobMaterial.dispose()
    },
  }
}

export type Rig = ReturnType<typeof createRig>

// ---------------------------------------------------------------- simulation state

export function createSim() {
  return {
    ens: new PendulumEnsemble(1, 0),
    /** angles before the last step of the frame, for drawing between steps */
    prev1: new Float64Array(MAX_COPIES),
    prev2: new Float64Array(MAX_COPIES),
    /** real time not yet integrated, in simulated seconds (< DT) */
    acc: 0,
    serial: NaN,
    nudge: NaN,
    /** tip samples, slot·MAX_COPIES + k; `head` is the next slot to write */
    trailX: new Float32Array(TRAIL_LEN * MAX_COPIES),
    trailY: new Float32Array(TRAIL_LEN * MAX_COPIES),
    head: 0,
    filled: 0,
    /** step count at which the newest sample was taken */
    sampleStep: -1,
    /** drawn tips (between steps), the trail's live end */
    tipX: new Float32Array(MAX_COPIES),
    tipY: new Float32Array(MAX_COPIES),
    /** each copy's z in the deck */
    z: new Float32Array(MAX_COPIES),
    /** geometry needs rewriting */
    dirty: true,
    deck: 0,
    spread: 0,
  }
}

export type Sim = ReturnType<typeof createSim>

/**
 * One frame: apply the store protocol, integrate `delta` real seconds if running, follow the
 * deck spacing, and rewrite the geometry if anything moved.
 */
export function advance(s: Sim, rig: Rig, p: PendulumState, delta: number, deck: number): void {
  const ens = s.ens
  const count = clampCount(p.count)
  const nudge = Number.isFinite(p.nudge) ? p.nudge : 0

  if (p.resetSerial !== s.serial || (ens.steps === 0 && (count !== ens.count || nudge !== s.nudge))) {
    rebuild(s, rig, count, nudge)
    s.serial = p.resetSerial
  }

  if (p.running) {
    s.acc += Math.min(Math.max(delta, 0), MAX_FRAME) * SPEED
    const n = Math.floor(s.acc / DT)
    s.acc -= n * DT
    for (let i = 0; i < n; i++) {
      if (i === n - 1) keepPrevious(s)
      ens.step()
      if (ens.steps % TRAIL_EVERY === 0) sample(s)
    }
    // the drawn state moves even on a frame with no whole step (displays above 720 Hz)
    s.dirty = true
    if (n > 0) s.spread = ens.spread()
  }

  if (deck !== s.deck) {
    s.deck = deck
    s.dirty = true
  }
  if (s.dirty) {
    writeGeometry(s, rig, s.acc / DT)
    s.dirty = false
  }
}

/** 'auto' deck spacing for a camera looking along `forward`, the group's z axis being `axis` (both unit). */
export function autoDeck(forward: THREE.Vector3, axis: THREE.Vector3): number {
  const c = Math.abs(forward.dot(axis))
  return DECK_SPACING * smoothstep(DECK_CLOSED_BELOW, DECK_OPEN_ABOVE, Math.sqrt(Math.max(0, 1 - c * c)))
}

function clampCount(c: number) {
  return Math.max(1, Math.min(MAX_COPIES, Math.round(c) || 1))
}

/** All copies back at the release with the given count and nudge; on a count change also the
 *  per-copy colours and the trail buffers. */
function rebuild(s: Sim, rig: Rig, count: number, nudge: number) {
  const ens = s.ens
  ens.reset(count, nudge)
  s.nudge = nudge
  s.acc = 0
  keepPrevious(s)
  s.head = 0
  s.filled = 0
  sample(s)
  s.spread = ens.spread()
  s.dirty = true

  const n = ens.count
  rig.rods.line.geometry.instanceCount = 2 * n
  rig.bobGeometry.setDrawRange(0, n * 2)
  if (rig.builtFor === n) return
  rig.builtFor = n

  // per-copy colours depend only on the count
  const c = _color
  for (let k = 0; k < n; k++) {
    speedColor(copyHue(k, n), c)
    const e = 2 * k
    rig.bobColors[e * 3] = c.r * ELBOW_GAIN
    rig.bobColors[e * 3 + 1] = c.g * ELBOW_GAIN
    rig.bobColors[e * 3 + 2] = c.b * ELBOW_GAIN
    rig.bobColors[e * 3 + 3] = c.r * TIP_GAIN
    rig.bobColors[e * 3 + 4] = c.g * TIP_GAIN
    rig.bobColors[e * 3 + 5] = c.b * TIP_GAIN
    rig.bobSizes[e] = ELBOW_PX
    rig.bobSizes[e + 1] = TIP_PX
  }
  rig.bobColorAttr.needsUpdate = true
  rig.bobSizeAttr.needsUpdate = true

  // trails: sized for this count; colours depend only on (age, copy) in the age-major layout
  size(rig.trails, TRAIL_LEN * n)
  const col = rig.trails.col
  for (let k = 0; k < n; k++) {
    speedColor(copyHue(k, n), c)
    const r = c.r * TRAIL_GAIN
    const gr = c.g * TRAIL_GAIN
    const b = c.b * TRAIL_GAIN
    for (let a = 0; a < TRAIL_LEN; a++) {
      const b0 = Math.pow(1 - a / TRAIL_LEN, TRAIL_FADE)
      const b1 = Math.pow(1 - (a + 1) / TRAIL_LEN, TRAIL_FADE)
      const o = (a * n + k) * 6
      col[o] = r * b0
      col[o + 1] = gr * b0
      col[o + 2] = b * b0
      col[o + 3] = r * b1
      col[o + 4] = gr * b1
      col[o + 5] = b * b1
    }
  }
  rig.trails.colBuffer.needsUpdate = true
}

/** Remember the angles before a step, to draw between it and the next. */
function keepPrevious(s: Sim) {
  const ens = s.ens
  for (let k = 0; k < ens.count; k++) {
    s.prev1[k] = ens.t1[k]
    s.prev2[k] = ens.t2[k]
  }
}

/** Push every copy's current tip (at the integration step, not between steps) into the trail ring. */
function sample(s: Sim) {
  const ens = s.ens
  const base = s.head * MAX_COPIES
  for (let k = 0; k < ens.count; k++) {
    const t1 = ens.t1[k]
    const t2 = ens.t2[k]
    s.trailX[base + k] = L1 * Math.sin(t1) + L2 * Math.sin(t2)
    s.trailY[base + k] = -L1 * Math.cos(t1) - L2 * Math.cos(t2)
  }
  s.head = s.head + 1 === TRAIL_LEN ? 0 : s.head + 1
  if (s.filled < TRAIL_LEN) s.filled++
  s.sampleStep = ens.steps
}

/**
 * Rods, bobs and trails at the drawn state: `alpha` of the way through the last step (the
 * integrator runs ahead of the clock by less than one step), so motion is smooth at any
 * frame rate while the trajectory itself never depends on it.
 */
function writeGeometry(s: Sim, rig: Rig, alpha: number) {
  const ens = s.ens
  const n = ens.count
  const rp = rig.rods.pos
  const bp = rig.bobPositions
  const Z = s.z

  for (let k = 0; k < n; k++) {
    const a1 = s.prev1[k] + (ens.t1[k] - s.prev1[k]) * alpha
    const a2 = s.prev2[k] + (ens.t2[k] - s.prev2[k]) * alpha
    const ex = L1 * Math.sin(a1)
    const ey = -L1 * Math.cos(a1)
    const tx = ex + L2 * Math.sin(a2)
    const ty = ey - L2 * Math.cos(a2)
    const z = (k - n / 2) * s.deck
    Z[k] = z
    s.tipX[k] = tx
    s.tipY[k] = ty

    const o = k * 12
    rp[o] = 0
    rp[o + 1] = 0
    rp[o + 2] = z
    rp[o + 3] = ex
    rp[o + 4] = ey
    rp[o + 5] = z
    rp[o + 6] = ex
    rp[o + 7] = ey
    rp[o + 8] = z
    rp[o + 9] = tx
    rp[o + 10] = ty
    rp[o + 11] = z

    const v = k * 6
    bp[v] = ex
    bp[v + 1] = ey
    bp[v + 2] = z
    bp[v + 3] = tx
    bp[v + 4] = ty
    bp[v + 5] = z
  }
  // small (≤ 9.6 kB and 4.8 kB): uploaded whole
  rig.rods.posBuffer.needsUpdate = true
  rig.bobPosAttr.needsUpdate = true

  // trails: point age 0 is the drawn tip, age j ≥ 1 the j-th newest sample. A sample taken on
  // the very last step lies ahead of the drawn tip, so it waits until the next frame.
  // (no trail before the release: its only segment would have zero length)
  const skip = s.sampleStep === ens.steps && ens.steps > 0 ? 1 : 0
  const segs = ens.steps > 0 ? Math.max(0, s.filled - skip) : 0
  const tp = rig.trails.pos
  const X = s.trailX
  const Y = s.trailY
  const newest = s.head - skip
  if (segs > 0) {
    // age 0 → 1: the drawn tip to the newest sample
    const to = ringSlot(newest - 1) * MAX_COPIES
    for (let k = 0, o = 0; k < n; k++, o += 6) {
      tp[o] = s.tipX[k]
      tp[o + 1] = s.tipY[k]
      tp[o + 2] = Z[k]
      tp[o + 3] = X[to + k]
      tp[o + 4] = Y[to + k]
      tp[o + 5] = Z[k]
    }
  }
  for (let a = 1; a < segs; a++) {
    const from = ringSlot(newest - a) * MAX_COPIES
    const to = ringSlot(newest - a - 1) * MAX_COPIES
    for (let k = 0, o = a * n * 6; k < n; k++, o += 6) {
      tp[o] = X[from + k]
      tp[o + 1] = Y[from + k]
      tp[o + 2] = Z[k]
      tp[o + 3] = X[to + k]
      tp[o + 4] = Y[to + k]
      tp[o + 5] = Z[k]
    }
  }
  rig.trails.posBuffer.needsUpdate = true
  rig.trails.line.geometry.instanceCount = segs * n
}

/** trail ring slot of any integer index (wraps negatives) */
function ringSlot(i: number) {
  return ((i % TRAIL_LEN) + TRAIL_LEN) % TRAIL_LEN
}

const _color = new THREE.Color()

function smoothstep(a: number, b: number, t: number) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}
