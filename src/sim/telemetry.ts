/**
 * Mutable, non-reactive numbers written by the simulation every frame and read by
 * HUD/instruments on their own cadence. Deliberately outside the zustand store so
 * 60 Hz updates never trigger React renders.
 */
export const SEP_CAP = 4096

export const tele = {
  /** accumulated simulated time (system units) since the last spawn/start */
  simTime: 0,
  /** integration steps the sim clock decided to run this frame (same for swarm and lines) */
  stepsThisFrame: 0,
  /** dt used this frame */
  dt: 0.005,
  /** current separation between the two trajectories (NaN when fewer than 2) */
  twinSep: NaN,
  /** sampled separation history: time + distance, ring written from index 0 upward (reset on start) */
  sepT: new Float32Array(SEP_CAP),
  sepD: new Float32Array(SEP_CAP),
  sepCount: 0,
  /** smoothed frames per second */
  fps: 60,
  /** particles in the swarm (set once the GPU sim exists) */
  particleCount: 0,
  /** extra integration steps requested from outside (system switches, dev fast-forward) */
  queuedSteps: 0,
  /** how many of the queued steps the clock runs per frame */
  burstPerFrame: 4096,
}

/**
 * Ask the clock to run `steps` extra steps spread over about `frames` frames, so a
 * transient (e.g. the swarm flowing onto a newly selected attractor) plays out quickly
 * but visibly rather than as one jump.
 */
export function queueSteps(steps: number, frames = 1) {
  tele.queuedSteps += steps
  tele.burstPerFrame = Math.max(1, Math.ceil(tele.queuedSteps / Math.max(1, frames)))
}

export function resetSeparation() {
  tele.sepCount = 0
  tele.twinSep = NaN
}
