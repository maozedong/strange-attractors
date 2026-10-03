/**
 * The logistic map x → r·x·(1 − x) and the numbers the two chapters quote, plus the mapping
 * from (r, xₙ) to the bifurcation plane's local coordinates. Pure functions, no three.js, so
 * the cloud builder can run in a worker.
 *
 * Two layouts share one point cloud:
 *  'r'  the textbook diagram: r ∈ [2.5, 4] across, xₙ ∈ [0, 1] up.
 *  'c'  the same orbits in the coordinates of the conjugate quadratic map z → z² + c, with
 *       c = r/2 − r²/4 and z = r/2 − r·xₙ, so the diagram can stand on the real axis of a
 *       Mandelbrot plane: c ∈ [−2, 0.25] across (linear in c), z ∈ [−2, 2] up. The conjugacy is
 *       exact, so period doublings sit at the same orbits in both layouts. Note that c falls as r
 *       rises and z falls as xₙ rises, so the 'c' layout is the 'r' one turned 180° and
 *       stretched non-linearly.
 */

export type Coord = 'r' | 'c'

export const R_MIN = 2.5
export const R_MAX = 4
export const C_MIN = -2
export const C_MAX = 0.25
export const Z_MIN = -2
export const Z_MAX = 2

/** r at which the period-2ᵏ cycle loses stability and doubles to 2ᵏ⁺¹ (k = 0 … 5). */
export const PERIOD_DOUBLINGS: readonly number[] = [
  3, 3.449489743, 3.544090359, 3.564407266, 3.56875942, 3.569691610,
]
/** r∞, where the cascade accumulates and chaos begins */
export const FEIGENBAUM_POINT = 3.569945672
/** δ: each doubling window is this many times shorter (in r) than the one before */
export const FEIGENBAUM_DELTA = 4.669201609
/** α: each generation of branches is this many times smaller (in xₙ) and flips side */
export const FEIGENBAUM_ALPHA = 2.502907875
/** the period-3 window, from its saddle-node birth to its first doubling */
export const PERIOD3_WINDOW: readonly [number, number] = [3.8284, 3.8415]

export function logistic(r: number, x: number): number {
  return r * x * (1 - x)
}

// ---------------------------------------------------------------- coordinate helpers

/** r ∈ [2.5, 4] → local x ∈ [−width/2, +width/2] ('r' layout) */
export function rToX(r: number, width: number): number {
  return ((r - R_MIN) / (R_MAX - R_MIN) - 0.5) * width
}

/** xₙ ∈ [0, 1] → local y ∈ [−height/2, +height/2] ('r' layout) */
export function xToY(x: number, height: number): number {
  return (x - 0.5) * height
}

/** c ∈ [−2, 0.25] → local x ∈ [−width/2, +width/2] ('c' layout) */
export function cToX(c: number, width: number): number {
  return ((c - C_MIN) / (C_MAX - C_MIN) - 0.5) * width
}

/** z ∈ [−2, 2] → local y ∈ [−height/2, +height/2] ('c' layout) */
export function zToY(z: number, height: number): number {
  return ((z - Z_MIN) / (Z_MAX - Z_MIN) - 0.5) * height
}

/** the quadratic-map parameter conjugate to r */
export function rToC(r: number): number {
  return r / 2 - (r * r) / 4
}

/** the quadratic-map point conjugate to the logistic point xₙ at parameter r */
export function xToZ(x: number, r: number): number {
  return r / 2 - r * x
}

/** local x of parameter r in either layout */
export function plotX(r: number, width: number, coord: Coord = 'r'): number {
  return coord === 'c' ? cToX(rToC(r), width) : rToX(r, width)
}

/** local y of orbit point xₙ (at parameter r) in either layout */
export function plotY(r: number, x: number, height: number, coord: Coord = 'r'): number {
  return coord === 'c' ? zToY(xToZ(x, r), height) : xToY(x, height)
}

// ---------------------------------------------------------------- the cascade

const forkCache: number[] = []

/**
 * The point of the 2ᵏ-cycle nearest the critical point ½ at r = PERIOD_DOUBLINGS[k]: the fork
 * where that branch splits. Successive forks close in on ½ by −1/α, alternating sides, which is
 * what makes the cascade self-similar. Found by Newton on f^(2ᵏ)(x) − x: at the doubling the
 * cycle multiplier is −1, so the root is simple and Newton converges in a few steps even
 * though plain iteration crawls there.
 */
export function forkPoint(k: number): number {
  const cached = forkCache[k]
  if (cached !== undefined) return cached
  const r = PERIOD_DOUBLINGS[k]
  const n = 2 ** k
  let x = 0.5
  for (let i = 0; i < 4096; i++) x = logistic(r, x)
  for (let it = 0; it < 60; it++) {
    let y = x
    let d = 1
    for (let i = 0; i < n; i++) {
      d *= r * (1 - 2 * y)
      y = logistic(r, y)
    }
    const step = (y - x) / (d - 1)
    x -= step
    if (Math.abs(step) < 1e-15) break
  }
  let best = x
  let y = x
  for (let i = 0; i < n; i++) {
    y = logistic(r, y)
    if (Math.abs(y - 0.5) < Math.abs(best - 0.5)) best = y
  }
  forkCache[k] = best
  return best
}

export interface CascadeFrame {
  /** centre, local units: the fork at PERIOD_DOUBLINGS[k] */
  x: number
  y: number
  /** 2.5 × the k-th doubling window, so successive frames shrink by ≈ δ */
  halfWidth: number
  /**
   * 1.75 × the vertical step from fork k to fork k+1, so successive frames shrink by ≈ α.
   * Fork k+1 sits above the centre for odd k and below it for even k (in the 'r' layout;
   * the 'c' layout is the other way up).
   */
  halfHeight: number
}

/** how much vertical room a frame leaves around the step to the next fork */
const FRAME_KAPPA = 1.75

/**
 * Frame for zooming onto the k-th period doubling (k = 0 … 4, clamped), in the group's local
 * units. Horizontally the cascade repeats when scaled by δ ≈ 4.67, vertically by α ≈ 2.50, so a
 * zoom that should show "the same picture again" scales x and y differently: fit halfWidth
 * across and halfHeight up. Fitting halfWidth alone (an isotropic zoom) loses fork k+1 off the
 * top or bottom of the screen from k = 2 on.
 */
export function cascadeFrame(k: number, width: number, height: number, coord: Coord = 'r'): CascadeFrame {
  const i = Math.max(0, Math.min(PERIOD_DOUBLINGS.length - 2, Math.round(k)))
  const r0 = PERIOD_DOUBLINGS[i]
  const r1 = PERIOD_DOUBLINGS[i + 1]
  const f0 = forkPoint(i)
  const f1 = forkPoint(i + 1)
  const x = plotX(r0, width, coord)
  const y = plotY(r0, f0, height, coord)
  return {
    x,
    y,
    halfWidth: 2.5 * Math.abs(plotX(r1, width, coord) - x),
    halfHeight: FRAME_KAPPA * Math.abs(plotY(r1, f1, height, coord) - y),
  }
}
