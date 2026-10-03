/** The exponent's tween toward the store value (no React, so verify.ts can test it). */

/** power tween: top speed (units / s) and acceleration (units / s²); 2 → 8 takes about 3.5 s */
export const POWER_RATE = 2
export const POWER_ACCEL = 4
export interface PowerTween {
  x: number
  v: number
}

/**
 * Speed-limited approach with eased start and stop (accelerate, cruise at POWER_RATE, brake at
 * the rate that stops exactly on the target); lands on the target exactly so the march can rest.
 */
export function approachPower(s: PowerTween, target: number, dt: number): void {
  const e = target - s.x
  if (Math.abs(e) < 1e-5 && Math.abs(s.v) < 1e-3) {
    s.x = target
    s.v = 0
    return
  }
  const want = Math.sign(e) * Math.min(POWER_RATE, Math.sqrt(2 * POWER_ACCEL * Math.abs(e)))
  const dv = POWER_ACCEL * dt
  s.v += Math.max(-dv, Math.min(dv, want - s.v))
  const next = s.x + s.v * dt
  if ((target - next) * e <= 0) {
    s.x = target
    s.v = 0
  } else {
    s.x = next
  }
}
