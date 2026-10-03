import type { CameraPose } from './cameraDirector'
import { cascadeFrame } from '../fractal/logistic'

/**
 * Where things stand on the two fractal stages, in world units, and the camera poses that
 * frame them. Chapters and cues import these so composition lives in one place.
 */
export const LOGISTIC_LAYOUT = {
  tap: [-1.9, 0.55, 0.2] as [number, number, number],
  diagram: [0.4, 0, 0] as [number, number, number],
  diagramW: 3.4,
  diagramH: 2.2,
  tapPose: { position: [-1.9, -0.05, 3.7], target: [-1.9, -0.2, 0] } as CameraPose,
  diagramPose: { position: [0.1, 0.1, 5.2], target: [0.1, 0.05, 0] } as CameraPose,
}

export const SHADOW_LAYOUT = {
  /** the Mandelbrot plane lies flat in XZ; this is its size */
  planeW: 4,
  planeH: 3,
  /** the diagram stands over the real axis; c ∈ [−2, 0.25] at overview scale 1.1 */
  diagram: [-0.25, 1.0, 0] as [number, number, number],
  diagramW: 2.25 / 1.1,
  diagramH: 2.0,
  topPose: { position: [-0.25, 3.4, 0.9], target: [-0.25, 0, 0] } as CameraPose,
  threeQuarterPose: { position: [-0.5, 2.3, 4.0], target: [-0.3, 0.6, 0] } as CameraPose,
  zoomPose: { position: [0, 3.0, 0.01], target: [0, 0, 0] } as CameraPose,
  /** julia chapter: two upright planes side by side */
  juliaPose: { position: [0, 0, 6.1], target: [0, 0, 0] } as CameraPose,
  juliaPlaneW: 2.2,
}

export const FLESH_LAYOUT = {
  ifsSize: 3.2,
  ifsPose: { position: [0, 0, 4.6], target: [0, 0, 0] } as CameraPose,
  coastW: 2.4,
  coastH: 3.2,
  coastPose: { position: [0, 0, 4.9], target: [0, 0, 0] } as CameraPose,
  bulbPose: { position: [2.3, 1.1, 2.4], target: [0, 0, 0] } as CameraPose,
  /** close to a bud: buds on buds */
  bulbDivePose: { position: [0.95, 0.42, 0.98], target: [0.55, 0.18, 0.5] } as CameraPose,
  catSize: 2.6,
  catPose: { position: [0, 0, 4.1], target: [0, 0, 0] } as CameraPose,
}

/** camera pose that frames the k-th period doubling on the standing diagram */
export function cascadePose(k: number): CameraPose {
  const f = cascadeFrame(k, LOGISTIC_LAYOUT.diagramW, LOGISTIC_LAYOUT.diagramH)
  const aspect = typeof window !== 'undefined' ? Math.max(1, window.innerWidth / window.innerHeight) : 1.6
  // visible half-height = dist · tan(fov/2), half-width = that × aspect, fov = 40°; the
  // text panel covers ~a third of the width, hence the 0.7
  const tan = Math.tan((20 * Math.PI) / 180)
  const dist = Math.max(0.025, f.halfWidth / (tan * aspect * 0.7), f.halfHeight / (tan * 0.85))
  const [dx, dy, dz] = LOGISTIC_LAYOUT.diagram
  return { position: [dx + f.x, dy + f.y, dz + dist], target: [dx + f.x, dy + f.y, dz] }
}


/** Wing IV: chaos in the world */
export const WORLD_LAYOUT = {
  /** pivot at the origin; the arms hang to −Y, so look a little below the pivot */
  /** the rig already shifts the subject clear of the text panel, so these ignore the panel */
  pendulumPose: { position: [0, -0.32, 3.9], target: [0, -0.32, 0] } as CameraPose,
  pendulumSidePose: { position: [3.3, -0.2, 2.3], target: [0, -0.32, 0] } as CameraPose,
  forecastPose: { position: [0, 2.53, 4.76], target: [0, 0.32, 0] } as CameraPose,
  forecastTopPose: { position: [0, 6.48, 1.0], target: [0, 0.8, 0] } as CameraPose,
  voicePose: { position: [0, 0.5, 5.2], target: [0, 0, 0] } as CameraPose,
  hyperionPose: { position: [4.2, 2.4, 4.8], target: [0.4, 0, 0] } as CameraPose,
  /** follow distances from the moon (outward from Saturn, so Saturn stays in the background) */
  hyperionFollowClose: { dist: 1.15, up: 0.3, side: 0.25 },
  hyperionFollowWide: { dist: 2.1, up: 0.5, side: 0.4 },
  taffyPose: { position: [0, 0, 3.9], target: [0, 0, 0] } as CameraPose,
  lampsPose: { position: [0, 0, 4.4], target: [0, 0, 0] } as CameraPose,
  lampsW: 4.8,
  lampsH: 3.2,
}

/** Wing V: order from nothing */
export const EMERGENCE_LAYOUT = {
  flockPose: { position: [0, 0.8, 7.0], target: [0, 0, 0] } as CameraPose,
  turingPose: { position: [0, 0.4, 5.0], target: [0, 0, 0] } as CameraPose,
  leniaPose: { position: [0, 0, 5.0], target: [0, 0, 0] } as CameraPose,
  firefliesPose: { position: [0, 0.15, 5.0], target: [0, -0.05, 0] } as CameraPose,
  sandpilePose: { position: [0, 0, 4.75], target: [0, 0, 0] } as CameraPose,
}
