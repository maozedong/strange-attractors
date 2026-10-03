import type { AttractorSystem, Vec3 } from '../types'

const k1 = new Float64Array(3)
const k2 = new Float64Array(3)
const k3 = new Float64Array(3)
const k4 = new Float64Array(3)
const tmp = new Float64Array(3)

/** One classical RK4 step, in place. `p` is [x,y,z] in system units. */
export function rk4Step(sys: AttractorSystem, p: Float64Array, P: number[], dt: number): void {
  const h = dt
  sys.f(k1, p[0], p[1], p[2], P)
  tmp[0] = p[0] + 0.5 * h * k1[0]
  tmp[1] = p[1] + 0.5 * h * k1[1]
  tmp[2] = p[2] + 0.5 * h * k1[2]
  sys.f(k2, tmp[0], tmp[1], tmp[2], P)
  tmp[0] = p[0] + 0.5 * h * k2[0]
  tmp[1] = p[1] + 0.5 * h * k2[1]
  tmp[2] = p[2] + 0.5 * h * k2[2]
  sys.f(k3, tmp[0], tmp[1], tmp[2], P)
  tmp[0] = p[0] + h * k3[0]
  tmp[1] = p[1] + h * k3[1]
  tmp[2] = p[2] + h * k3[2]
  sys.f(k4, tmp[0], tmp[1], tmp[2], P)
  const s = h / 6
  p[0] += s * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
  p[1] += s * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
  p[2] += s * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
}

/** |dp/dt| at p */
export function speedAt(sys: AttractorSystem, p: Float64Array | Vec3, P: number[]): number {
  sys.f(k1, p[0], p[1], p[2], P)
  return Math.hypot(k1[0], k1[1], k1[2])
}

/**
 * Integrate one trajectory and return `count` positions as a flat Float32Array (xyz...).
 * `transient` steps are discarded first so the samples lie on the attractor; `stride`
 * steps are taken between kept samples so consecutive samples decorrelate a little.
 */
export function sampleTrajectory(
  sys: AttractorSystem,
  P: number[],
  origin: Vec3,
  count: number,
  opts: { dt?: number; transient?: number; stride?: number } = {},
): Float32Array {
  const dt = opts.dt ?? sys.dt
  const transient = opts.transient ?? 2000
  const stride = Math.max(1, opts.stride ?? 1)
  const p = new Float64Array(origin)
  for (let i = 0; i < transient; i++) rk4Step(sys, p, P, dt)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    for (let s = 0; s < stride; s++) rk4Step(sys, p, P, dt)
    if (!Number.isFinite(p[0] + p[1] + p[2])) {
      // escaped: restart from origin so the array never contains NaN
      p.set(origin)
      for (let k = 0; k < transient; k++) rk4Step(sys, p, P, dt)
    }
    out[i * 3] = p[0]
    out[i * 3 + 1] = p[1]
    out[i * 3 + 2] = p[2]
  }
  return out
}
