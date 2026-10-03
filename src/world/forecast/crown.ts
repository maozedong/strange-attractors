import { L96_N } from './lorenz96'

/**
 * The "crown": one Lorenz-96 state drawn as a closed wavy ring in the local XZ plane (y up).
 * Site i sits at angle 2πi/N, counter-clockwise seen from +y (x = r cos θ, z = −r sin θ); its
 * value x_i pushes the ring outward and upward:  r = radius + CROWN_RADIAL·x,  y = CROWN_RISE·x.
 *
 * Between sites the value is interpolated with a periodic uniform Catmull-Rom spline in the
 * site index (CROWN_SUBDIV vertices per site), and the vertices are placed on the true circle,
 * so the curve passes through every station and the ring never cuts chords.
 *
 * Output is LineSegmentsGeometry's instance layout: per segment (start xyz, end xyz).
 *
 * The dial radius lives in a CrownRing (each vertex's base point, rebuilt only when the radius
 * changes), so the per-frame writer takes no floating-point arguments: a double handed to a
 * non-inlined function is boxed on the heap, and this runs every frame.
 */

export const CROWN_RADIAL = 0.05
export const CROWN_RISE = 0.12
export const CROWN_SUBDIV = 4
/** vertices (= segments) in one closed crown */
export const CROWN_VERTICES = L96_N * CROWN_SUBDIV
/** floats one crown occupies in a segment buffer */
export const CROWN_FLOATS = CROWN_VERTICES * 6

const N = L96_N
const S = CROWN_SUBDIV
const COS = new Float64Array(CROWN_VERTICES)
const SIN = new Float64Array(CROWN_VERTICES)
for (let k = 0; k < CROWN_VERTICES; k++) {
  const a = (2 * Math.PI * k) / CROWN_VERTICES
  COS[k] = Math.cos(a)
  SIN[k] = Math.sin(a)
}

/** Catmull-Rom weights of (p_{i−1}, p_i, p_{i+1}, p_{i+2}) at t = j / S, j = 0..S−1 */
const W = new Float64Array(S * 4)
for (let j = 0; j < S; j++) {
  const t = j / S
  const t2 = t * t
  const t3 = t2 * t
  W[j * 4] = 0.5 * (-t + 2 * t2 - t3)
  W[j * 4 + 1] = 0.5 * (2 - 5 * t2 + 3 * t3)
  W[j * 4 + 2] = 0.5 * (t + 4 * t2 - 3 * t3)
  W[j * 4 + 3] = 0.5 * (-t2 + t3)
}

/** Smoothed value at crown vertex k (0..CROWN_VERTICES) of the state x[xo .. xo + N). */
export function crownValue(x: Float64Array, xo: number, k: number): number {
  const i = Math.floor(k / S) % N
  const j = k % S
  const w = j * 4
  return (
    W[w] * x[xo + ((i + N - 1) % N)] +
    W[w + 1] * x[xo + i] +
    W[w + 2] * x[xo + ((i + 1) % N)] +
    W[w + 3] * x[xo + ((i + 2) % N)]
  )
}

/** Each crown vertex's point on the dial (x = 0) for one radius. */
export class CrownRing {
  /** x, z of vertex k at [2k], [2k + 1] */
  readonly base = new Float64Array(CROWN_VERTICES * 2)
  radius = NaN

  constructor(radius: number) {
    this.setRadius(radius)
  }

  setRadius(radius: number): void {
    if (radius === this.radius) return
    for (let k = 0; k < CROWN_VERTICES; k++) {
      this.base[2 * k] = radius * COS[k]
      this.base[2 * k + 1] = -radius * SIN[k]
    }
    this.radius = radius
  }
}

/**
 * Write the closed crown of state x[xo .. xo + N) on `ring` into out[oo .. oo + CROWN_FLOATS)
 * as CROWN_VERTICES segments, the last one closing back onto the first vertex.
 */
export function writeCrown(x: Float64Array, xo: number, ring: CrownRing, out: Float32Array, oo: number): void {
  const base = ring.base
  // vertex 0
  let v = x[xo]
  const x0 = base[0] + CROWN_RADIAL * v
  const y0 = CROWN_RISE * v
  const z0 = base[1]
  let ax = x0
  let ay = y0
  let az = z0
  let o = oo
  for (let i = 0; i < N; i++) {
    const pm = x[xo + (i === 0 ? N - 1 : i - 1)]
    const p0 = x[xo + i]
    const p1 = x[xo + (i + 1 === N ? 0 : i + 1)]
    const p2 = x[xo + (i + 2 >= N ? i + 2 - N : i + 2)]
    for (let j = 0; j < S; j++) {
      const k = i * S + j + 1 // the vertex this segment ends on
      let bx: number
      let by: number
      let bz: number
      if (k === CROWN_VERTICES) {
        bx = x0
        by = y0
        bz = z0
      } else {
        const jj = j + 1
        if (jj === S) {
          v = p1
        } else {
          const w = jj * 4
          v = W[w] * pm + W[w + 1] * p0 + W[w + 2] * p1 + W[w + 3] * p2
        }
        const dr = CROWN_RADIAL * v
        bx = base[2 * k] + dr * COS[k]
        by = CROWN_RISE * v
        bz = base[2 * k + 1] - dr * SIN[k]
      }
      out[o] = ax
      out[o + 1] = ay
      out[o + 2] = az
      out[o + 3] = bx
      out[o + 4] = by
      out[o + 5] = bz
      o += 6
      ax = bx
      ay = by
      az = bz
    }
  }
}

/** Angle of site i (radians), for anything that wants to label or tick the stations. */
export function siteAngle(i: number): number {
  return (2 * Math.PI * i) / N
}
