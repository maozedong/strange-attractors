import type { Vec3 } from '../types'

export interface CameraPose {
  position: Vec3
  target: Vec3
}

/**
 * Scripted camera moves. A chapter or a cue asks for a pose; the rig eases toward it
 * and stops as soon as the visitor drags, so autoplay never fights the hand.
 */
export interface XYZ {
  x: number
  y: number
  z: number
}
/** writes where to look and where the camera should be, every frame */
export type FollowFn = (outTarget: XYZ, outCamera: XYZ) => void

export const cameraDirector = {
  pose: null as CameraPose | null,
  /**
   * Follow mode: each frame the rig asks `follow` for the point to look at and the camera
   * position, eases in from wherever the camera was over `seconds`, then tracks exactly
   * (a moving subject cannot be followed with a lag). Cleared by `goTo`, `release` or a drag.
   */
  follow: null as FollowFn | null,
  /** seconds for the ease (approach rate derived from it) */
  seconds: 2,
  /** bumped on every request so the rig knows a new move started */
  serial: 0,
  goTo(pose: CameraPose, seconds = 2) {
    this.pose = pose
    this.follow = null
    this.seconds = seconds
    this.serial++
  },
  followTarget(follow: FollowFn, seconds = 2) {
    this.pose = null
    this.follow = follow
    this.seconds = seconds
    this.serial++
  },
  release() {
    this.pose = null
    this.follow = null
    this.serial++
  },
}
