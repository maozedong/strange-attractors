import { DynamicDrawUsage, type Color, type InterleavedBuffer, type InterleavedBufferAttribute } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/** With fade=false, only this oldest fraction of the history dims (so the drop-off at the tail never pops). */
const READABLE_TAIL = 0.15

/**
 * Brightness of a history point, 0..1. `u` is 1 for the newest point and 0 for a point of age
 * history-1 (the next one to be overwritten), so brightness is a function of age alone.
 */
export function tailBrightness(u: number, fade: boolean): number {
  if (fade) return Math.pow(u, 1.5)
  if (u >= READABLE_TAIL) return 1
  const x = u / READABLE_TAIL
  return x * x * (3 - 2 * x)
}

/**
 * One CPU trajectory: double-precision state, a ring buffer of past positions in system
 * units, and the Line2 that draws it. The GPU buffers are allocated once per history size
 * and rewritten in place every frame.
 */
export class TrajectoryLine {
  /** current state, system units */
  readonly p = new Float64Array(3)
  readonly line: Line2

  private capacity = 0
  /** xyz per slot, system units */
  private ring = new Float64Array(0)
  /** slot the next point goes into; the newest point is at head-1 */
  private head = 0
  /** valid points in the ring, ≤ capacity */
  private filled = 0
  /** brightness by age (index 0 = newest) */
  private lut = new Float32Array(0)
  private lutFade: boolean | null = null
  /** value of `filled` the colour buffer was last written for; -1 forces a rewrite */
  private colorsWrittenFor = -1

  private positions: Float32Array = new Float32Array(0)
  private colors: Float32Array = new Float32Array(0)
  private positionBuffer: InterleavedBuffer | null = null
  private colorBuffer: InterleavedBuffer | null = null

  constructor(material: LineMaterial) {
    this.line = new Line2(new LineGeometry(), material)
    this.line.frustumCulled = false
    this.line.visible = false
  }

  /** Size for `history` points and empty the ring. Reuses GPU buffers when the size is unchanged. */
  allocate(history: number, fade: boolean): void {
    if (history !== this.capacity) {
      const g = new LineGeometry()
      // LineGeometry converts n points into n-1 segments of interleaved (start xyz, end xyz)
      g.setPositions(new Float32Array(history * 3))
      g.setColors(new Float32Array(history * 3))
      const start = g.getAttribute('instanceStart') as InterleavedBufferAttribute
      const colorStart = g.getAttribute('instanceColorStart') as InterleavedBufferAttribute
      this.positionBuffer = start.data.setUsage(DynamicDrawUsage)
      this.colorBuffer = colorStart.data.setUsage(DynamicDrawUsage)
      this.positions = start.data.array as Float32Array
      this.colors = colorStart.data.array as Float32Array

      this.line.geometry.dispose()
      this.line.geometry = g
      this.ring = new Float64Array(history * 3)
      this.lut = new Float32Array(history)
      this.capacity = history
      this.lutFade = null
    }
    if (this.lutFade !== fade) {
      const last = this.capacity - 1
      for (let age = 0; age < this.capacity; age++) this.lut[age] = tailBrightness(1 - age / last, fade)
      this.lutFade = fade
    }
    this.head = 0
    this.filled = 0
    this.colorsWrittenFor = -1
    this.line.geometry.instanceCount = 0
    this.line.visible = false
  }

  /** Jump to a new state and drop the history (start, or recovery after escaping). */
  restart(x: number, y: number, z: number): void {
    this.p[0] = x
    this.p[1] = y
    this.p[2] = z
    this.head = 0
    this.filled = 0
    this.colorsWrittenFor = -1
    this.push(x, y, z)
  }

  push(x: number, y: number, z: number): void {
    const i = this.head * 3
    this.ring[i] = x
    this.ring[i + 1] = y
    this.ring[i + 2] = z
    this.head = this.head + 1 === this.capacity ? 0 : this.head + 1
    if (this.filled < this.capacity) this.filled++
  }

  /** Affine remap q = (p - from) * k + to of the state and every stored point (used on system switch). */
  remap(fx: number, fy: number, fz: number, k: number, tx: number, ty: number, tz: number): void {
    const p = this.p
    p[0] = (p[0] - fx) * k + tx
    p[1] = (p[1] - fy) * k + ty
    p[2] = (p[2] - fz) * k + tz
    const r = this.ring
    const cap = this.capacity
    let idx = (this.head - this.filled + cap) % cap
    for (let j = 0; j < this.filled; j++) {
      const i = idx * 3
      r[i] = (r[i] - fx) * k + tx
      r[i + 1] = (r[i + 1] - fy) * k + ty
      r[i + 2] = (r[i + 2] - fz) * k + tz
      idx = idx + 1 === cap ? 0 : idx + 1
    }
  }

  /**
   * Write the ring into the line's instance buffers, oldest → newest, in render units
   * (p - c) * s. Segment j joins the j-th oldest point to the (j+1)-th.
   */
  write(cx: number, cy: number, cz: number, s: number, color: Color): void {
    const n = this.filled
    const segs = n - 1
    if (segs < 1 || !this.positionBuffer || !this.colorBuffer) {
      this.line.visible = false
      return
    }
    const r = this.ring
    const pos = this.positions
    const cap = this.capacity

    let idx = (this.head - n + cap) % cap // oldest valid slot
    let i = idx * 3
    let ax = (r[i] - cx) * s
    let ay = (r[i + 1] - cy) * s
    let az = (r[i + 2] - cz) * s
    for (let j = 0, o = 0; j < segs; j++, o += 6) {
      idx = idx + 1 === cap ? 0 : idx + 1
      i = idx * 3
      const bx = (r[i] - cx) * s
      const by = (r[i + 1] - cy) * s
      const bz = (r[i + 2] - cz) * s
      pos[o] = ax
      pos[o + 1] = ay
      pos[o + 2] = az
      pos[o + 3] = bx
      pos[o + 4] = by
      pos[o + 5] = bz
      ax = bx
      ay = by
      az = bz
    }
    this.positionBuffer.needsUpdate = true

    // Brightness depends only on age, so once the ring is full the colours never change.
    if (this.colorsWrittenFor !== n) {
      const col = this.colors
      const lut = this.lut
      const cr = color.r
      const cg = color.g
      const cb = color.b
      for (let j = 0, o = 0; j < segs; j++, o += 6) {
        const b0 = lut[n - 1 - j] // age of segment start
        const b1 = lut[n - 2 - j] // age of segment end (one step younger)
        col[o] = cr * b0
        col[o + 1] = cg * b0
        col[o + 2] = cb * b0
        col[o + 3] = cr * b1
        col[o + 4] = cg * b1
        col[o + 5] = cb * b1
      }
      this.colorBuffer.needsUpdate = true
      this.colorsWrittenFor = n
    }

    this.line.geometry.instanceCount = segs
    this.line.visible = true
  }

  markColorsDirty(): void {
    this.colorsWrittenFor = -1
  }

  hide(): void {
    this.filled = 0
    this.head = 0
    this.line.geometry.instanceCount = 0
    this.line.visible = false
  }

  dispose(): void {
    this.line.geometry.dispose()
  }
}
