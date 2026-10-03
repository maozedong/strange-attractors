/**
 * The dials' glide: the simulation follows the store's feed and kill through a critically
 * damped spring, in simulation steps, so a jump of the dials arrives eased (like a tween) and
 * never all at once. Shared by TuringSphere and verify.ts, which checks the presets through it.
 */

/** default time constant in steps (≈ 0.35 s at 720 steps per second); 1 % of a jump is left after ~6.6 of them */
export const GLIDE_STEPS = 250

export interface Dials {
  f: number
  k: number
  /** rates of change per step */
  vf: number
  vk: number
}

/** Snap the dials to (f, k) at rest. */
export function snapDials(d: Dials, f: number, k: number): void {
  d.f = f
  d.k = k
  d.vf = 0
  d.vk = 0
}

/**
 * Advance the spring by `steps` steps toward (f, k): semi-implicit Euler, one update per call
 * (stable for steps up to ~tau; the time constant is never taken below `steps`). tau ≤ 0 snaps.
 */
export function glideDials(d: Dials, f: number, k: number, steps: number, tau = GLIDE_STEPS): void {
  if (!(tau > 0)) {
    snapDials(d, f, k)
    return
  }
  // semi-implicit Euler on a critically damped spring is stable only for w·steps ≤ 2(√2 − 1) ≈ 0.83;
  // keep the step a safe fraction of the period whatever `tau` is asked for
  const w = 1 / Math.max(tau, 1.25 * steps)
  d.vf += (w * w * (f - d.f) - 2 * w * d.vf) * steps
  d.vk += (w * w * (k - d.k) - 2 * w * d.vk) * steps
  d.f += d.vf * steps
  d.k += d.vk * steps
}
