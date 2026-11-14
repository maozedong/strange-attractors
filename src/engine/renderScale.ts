/**
 * How many device pixels the film draws per CSS pixel, chosen from how long frames take.
 *
 * Nearly every cost in a frame grows with the pixel count, so this is the one knob that can bring
 * a slow machine back to a smooth picture. The only thing a page can see is when its frames
 * arrive, and with vsync a frame that used half its time and one that used all of it arrive at the
 * same moment. So the two directions are asymmetric:
 *
 * - Down, quickly: when a good share of the last half second of frames came late, the scale
 *   drops at once, by more when the frames are much later than they should be.
 * - Up, slowly and by trial: after several calm seconds the scale goes up one small step. Each
 *   scale remembers being left for late frames, and the calm wait before trying it again doubles
 *   every time, so a machine on the edge between two sizes settles on the lower one instead of
 *   hunting. A step that brings late frames back soon after it was taken goes straight back down
 *   to where it came from. A scale that holds for a minute forgets its failures.
 *
 * It aims at 60 frames a second. A 120 Hz screen counts as comfortable at 60: at full resolution
 * that is what this film can reach on a laptop, and trading pixels for the last 60 frames is a
 * poor deal.
 *
 * It is plain arithmetic on frame intervals, with no clock or browser of its own, so it can be
 * driven by a list of frame times (scripts/renderScale.ts) to see how it behaves.
 */

export interface RenderScaleOptions {
  /** the highest scale, normally the screen's device pixel ratio capped at 2 */
  max: number
  /** the lowest scale it may go to */
  min: number
  /** the most device pixels a frame may have, whatever the scale */
  maxPixels: number
}

/** a frame at 60 frames a second */
const TARGET_MS = 1000 / 60
/** a frame this long missed its vsync at 60 Hz (or dropped below 60 on a faster screen) */
const LATE_MS = TARGET_MS * 1.4
/** longer than this is a stall (a tab coming back, a shader compiling), not load */
const STALL_MS = 250
/** frames over which the share of late frames is averaged: about half a second */
const WINDOW = 30
/** the share of late frames that brings the scale down */
const DROP_AT = 0.2
/** below this share the frames count as calm */
const CALM_AT = 0.05
/** frames to ignore after a change: reallocating the targets costs a frame or two */
const SETTLE_FRAMES = 20
/** calm seconds before trying a scale upwards, and the most that wait can grow to */
const RAISE_AFTER = 4
const RAISE_AFTER_MAX = 120
/** a step up that has to be taken back within this many seconds was a step too far */
const PROBE_SECONDS = 8
/** a scale that holds this long forgets that it ever failed */
const PROVEN_SECONDS = 60
/** scales are multiples of this, so a size is met again exactly and not at a near neighbour */
const QUANTUM = 0.125

export class RenderScale {
  /** the scale in use */
  scale: number
  private readonly opts: RenderScaleOptions
  private ceiling: number
  private late = 0
  /** intervals since the last change, for how deep a cut has to be */
  private sumMs = 0
  private count = 0
  private settle = SETTLE_FRAMES
  private calm = 0
  /** seconds at the current scale */
  private held = 0
  /** the scale before the last step up, while that step is on trial */
  private from = -1
  /** calm seconds a scale needs before it is tried again, for scales that have failed */
  private readonly wait = new Map<number, number>()

  constructor(opts: RenderScaleOptions, cssPixels: number) {
    this.opts = opts
    this.ceiling = opts.max
    this.setArea(cssPixels)
    this.scale = this.ceiling
  }

  /** the canvas changed size: recompute the ceiling, and come down to it if it is now lower */
  setArea(cssPixels: number) {
    const byPixels = Math.sqrt(this.opts.maxPixels / Math.max(1, cssPixels))
    this.ceiling = Math.max(this.opts.min, Math.min(this.opts.max, Math.floor(byPixels / QUANTUM) * QUANTUM))
    if (this.scale > this.ceiling) this.change(this.ceiling)
  }

  /**
   * One frame arrived `ms` after the one before. Returns the new scale when it should change,
   * otherwise null.
   */
  frame(ms: number): number | null {
    if (!(ms > 0) || ms > STALL_MS) return null
    if (this.settle > 0) {
      this.settle--
      return null
    }
    const s = ms / 1000
    this.late += ((ms > LATE_MS ? 1 : 0) - this.late) / WINDOW
    this.sumMs += ms
    this.count++
    this.held += s
    if (this.held > PROBE_SECONDS) this.from = -1
    if (this.held > PROVEN_SECONDS) this.wait.delete(this.scale)

    if (this.late > DROP_AT && this.scale > this.opts.min) {
      this.wait.set(this.scale, Math.min(RAISE_AFTER_MAX, 2 * (this.wait.get(this.scale) ?? RAISE_AFTER)))
      // a step up that failed at once goes back to where it came from
      if (this.from >= 0) return this.change(this.from)
      // pixels go roughly with the frame's cost; the measured interval is held to whole vsyncs,
      // so it understates the overload, and the cut is never smaller than a tenth
      const k = Math.min(0.9, Math.max(0.7, Math.sqrt(TARGET_MS / (this.sumMs / this.count))))
      let next = Math.max(this.opts.min, Math.floor((this.scale * k) / QUANTUM) * QUANTUM)
      if (next >= this.scale) next = Math.max(this.opts.min, this.scale - QUANTUM)
      return this.change(next)
    }

    this.calm = this.late < CALM_AT ? this.calm + s : 0
    if (this.scale < this.ceiling) {
      const up = Math.min(this.ceiling, this.scale + QUANTUM)
      if (this.calm > Math.max(RAISE_AFTER, this.wait.get(up) ?? 0)) {
        const from = this.scale
        this.change(up)
        this.from = from
        return up
      }
    }
    return null
  }

  private change(next: number): number {
    this.scale = next
    this.late = 0
    this.sumMs = 0
    this.count = 0
    this.calm = 0
    this.held = 0
    this.from = -1
    this.settle = SETTLE_FRAMES
    return next
  }
}
