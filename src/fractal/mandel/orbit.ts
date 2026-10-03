/**
 * The CPU half of the deep-zoom renderer: the reference orbit in JS doubles, the iteration
 * budget for a zoom depth, and the limits shared by the planes, the tween and the
 * verification script. Nothing here touches three.js or React, so node can run it.
 */

/** Width of the reference-orbit texture. Each RGBA texel holds two orbit entries (re, im, re, im). */
export const ORBIT_TEXELS = 2048
/** Orbit entries the texture can hold: Z_0 .. Z_{ORBIT_CAPACITY-1}. */
export const ORBIT_CAPACITY = ORBIT_TEXELS * 2
/** Hard iteration ceiling. Also the constant loop bound in the GLSL (keep in sync with the shader). */
export const MAX_ITER = 4000
export const MIN_ITER = 200

/** Deepest zoom. Float deltas would still work far below this; the limit is the iteration budget. */
export const MIN_SCALE = 1e-13
/** Widest view. */
export const MAX_SCALE = 4

/**
 * The reference orbit stops once |Z|² exceeds this. A small radius matters for rebasing (see
 * the shader): a pixel that has not escaped when the reference runs out restarts from
 * z = Z_M + δ_M, and keeping |Z_M| small (≤ 2² + |c| ≈ 6) keeps that sum free of cancellation.
 */
export const REFERENCE_BAILOUT_SQ = 4

/**
 * Iterations needed to resolve the boundary at a zoom depth: 200 at the overview, about
 * 2000 at 1e-6, the 4000 ceiling from about 1e-8 on. Zooming out past scale 1 does not raise it.
 */
export function maxIterForScale(scale: number): number {
  const depth = Math.max(0, Math.log10(1 / scale))
  const n = Math.round(MIN_ITER + 60 * depth * depth)
  return Math.min(Math.max(n, MIN_ITER), MAX_ITER, ORBIT_CAPACITY - 1)
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Iterate Z_{n+1} = Z_n² + c in doubles from Z_0 = 0 and store Z_0..Z_M into `out`
 * (entry n at out[2n], out[2n+1]; `out` must hold ORBIT_CAPACITY * 2 floats).
 * Stops at `maxIter` or when the orbit escapes (|Z_M|² > REFERENCE_BAILOUT_SQ, entry M
 * included). Returns M, the last valid index. Entries past M are left untouched.
 */
export function computeReferenceOrbit(
  cx: number,
  cy: number,
  maxIter: number,
  out: Float32Array | Float64Array,
): number {
  const limit = Math.min(maxIter, ORBIT_CAPACITY - 1)
  let x = 0
  let y = 0
  out[0] = 0
  out[1] = 0
  let n = 0
  while (n < limit) {
    const nx = x * x - y * y + cx
    y = 2 * x * y + cy
    x = nx
    n++
    out[2 * n] = x
    out[2 * n + 1] = y
    if (x * x + y * y > REFERENCE_BAILOUT_SQ) break
  }
  return n
}

/** Plain double-precision escape time of c (iterations until |z| > 2), or -1 if it survives `maxIter`. */
export function escapeTime(cx: number, cy: number, maxIter: number): number {
  let x = 0
  let y = 0
  for (let n = 1; n <= maxIter; n++) {
    const nx = x * x - y * y + cx
    y = 2 * x * y + cy
    x = nx
    if (x * x + y * y > 4) return n
  }
  return -1
}
