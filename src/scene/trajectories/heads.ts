import type { Vec3 } from '../../types'

/**
 * Current head of every live trajectory, in WORLD space: the render-space point
 * (p - frame.center) * frame.scale with the scene's rotation-x(-π/2) applied, i.e. [x, z, -y].
 *
 * Kept in its own module (not Trajectories.tsx) so that file only exports components and
 * React Fast Refresh keeps working on it.
 */
const pool: Vec3[] = [
  [0, 0, 0],
  [0, 0, 0],
]
const live: Vec3[] = []

/**
 * Returns a live, reused array: its length is the number of trajectories, and its Vec3
 * entries are overwritten in place every frame. Copy the values if you need to keep them.
 */
export function getTrajectoryHeads(): Vec3[] {
  return live
}

/** @internal written by TrajectoryEngine on start/clear only */
export function setTrajectoryHeadCount(n: number): void {
  live.length = 0
  for (let i = 0; i < n && i < pool.length; i++) live.push(pool[i])
}

/** @internal written by TrajectoryEngine every frame */
export function setTrajectoryHead(i: number, x: number, y: number, z: number): void {
  const h = pool[i]
  h[0] = x
  h[1] = y
  h[2] = z
}
