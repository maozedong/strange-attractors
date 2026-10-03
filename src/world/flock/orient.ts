import type { Flock } from './boids'

/**
 * Bird poses for the instance matrices, without three.
 *
 * Forward is the velocity. The wings bank the way a bird's do in a coordinated turn: the wing
 * normal points along the lift, which carries the bird's own acceleration plus a constant
 * "gravity" BANK_GRAVITY, with the component along the flight direction removed. Flying
 * straight, the wings are level; turning hard, they tilt into the turn. A turn that runs
 * through the flock as a wave therefore tilts every wing in it, and the shader (which shades
 * by the wing's angle to the eye) turns that into the murmuration's travelling shimmer.
 *
 * The acceleration is smoothed per bird over BANK_SMOOTHING so the noise does not make the
 * wings flutter. Writes matrices straight into the InstancedMesh's array: columns right, up,
 * forward (scaled), then position. Element 15 and the zeros of row 4 are never written: set
 * them once. Allocates nothing.
 */

/** render units per second²: a turn of this lateral acceleration banks the wings 45° */
export const BANK_GRAVITY = 1.6
/** seconds */
export const BANK_SMOOTHING = 0.15

export interface BirdPose {
  /** smoothed acceleration per bird */
  lift: Float32Array
  /** the flock generation the smoothing belongs to; a respawn restarts it */
  generation: number
}

export function createBirdPose(capacity: number): BirdPose {
  return { lift: new Float32Array(capacity * 3), generation: -1 }
}

export function writeBirdMatrices(f: Flock, pose: BirdPose, out: Float32Array, dt: number, scale: number) {
  const { vel, pos, acc } = f
  const lift = pose.lift
  const reset = pose.generation !== f.generation
  pose.generation = f.generation
  const k = reset ? 1 : 1 - Math.exp(-Math.max(dt, 0) / BANK_SMOOTHING)
  const n = f.n
  // the pose of writePose, inlined by hand: a call taking doubles would box them, a dozen
  // allocations per bird per frame
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const ax = (lift[i3] += (acc[i3] - lift[i3]) * k)
    const ay = (lift[i3 + 1] += (acc[i3 + 1] - lift[i3 + 1]) * k)
    const az = (lift[i3 + 2] += (acc[i3 + 2] - lift[i3 + 2]) * k)
    let fx = vel[i3], fy = vel[i3 + 1], fz = vel[i3 + 2]
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz)
    if (fl > 1e-9) {
      fx /= fl
      fy /= fl
      fz /= fl
    } else {
      fx = 0
      fy = 0
      fz = 1
    }
    const Ly = ay + BANK_GRAVITY
    const d = ax * fx + Ly * fy + az * fz
    let ux = ax - d * fx, uy = Ly - d * fy, uz = az - d * fz
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
    if (ul < 1e-6) {
      const level = Math.abs(fy) < 0.99
      const e = level ? fy : fx
      ux = (level ? 0 : 1) - e * fx
      uy = (level ? 1 : 0) - e * fy
      uz = -e * fz
      ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
    }
    ux /= ul
    uy /= ul
    uz /= ul
    const o = i * 16
    out[o] = (uy * fz - uz * fy) * scale
    out[o + 1] = (uz * fx - ux * fz) * scale
    out[o + 2] = (ux * fy - uy * fx) * scale
    out[o + 4] = ux * scale
    out[o + 5] = uy * scale
    out[o + 6] = uz * scale
    out[o + 8] = fx * scale
    out[o + 9] = fy * scale
    out[o + 10] = fz * scale
    out[o + 12] = pos[i3]
    out[o + 13] = pos[i3 + 1]
    out[o + 14] = pos[i3 + 2]
  }
}

/** One pose: position p, flying along v, banked by acceleration a, at uniform scale s. The
 *  same as each bird in writeBirdMatrices; for single objects (the hawk). */
export function writePose(
  out: Float32Array | number[],
  o: number,
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  ax: number, ay: number, az: number,
  s: number,
) {
  let fx = vx, fy = vy, fz = vz
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz)
  if (fl > 1e-9) {
    fx /= fl
    fy /= fl
    fz /= fl
  } else {
    fx = 0
    fy = 0
    fz = 1
  }
  // lift, perpendicular to the flight
  const Lx = ax, Ly = ay + BANK_GRAVITY, Lz = az
  const d = Lx * fx + Ly * fy + Lz * fz
  let ux = Lx - d * fx, uy = Ly - d * fy, uz = Lz - d * fz
  let ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
  if (ul < 1e-6) {
    // straight up or down with nothing pulling sideways: any perpendicular will do
    const e = Math.abs(fy) < 0.99 ? fy : fx
    ux = (Math.abs(fy) < 0.99 ? 0 : 1) - e * fx
    uy = (Math.abs(fy) < 0.99 ? 1 : 0) - e * fy
    uz = -e * fz
    ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
  }
  ux /= ul
  uy /= ul
  uz /= ul
  // right = up × forward (right-handed: local +X right, +Y up, +Z forward)
  const rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx
  out[o] = rx * s
  out[o + 1] = ry * s
  out[o + 2] = rz * s
  out[o + 4] = ux * s
  out[o + 5] = uy * s
  out[o + 6] = uz * s
  out[o + 8] = fx * s
  out[o + 9] = fy * s
  out[o + 10] = fz * s
  out[o + 12] = px
  out[o + 13] = py
  out[o + 14] = pz
}
