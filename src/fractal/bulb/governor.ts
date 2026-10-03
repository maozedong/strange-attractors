/**
 * Chooses the ray march's internal resolution from the frame rate, aiming at 60 fps.
 *
 * It keeps a budget of march pixels per frame rather than a scale: the march costs about the
 * same per covered pixel, so when the camera dives in and the bulb fills more of the view the
 * scale drops on that very frame, instead of after a run of slow frames. The caller converts
 * with scaleFor(area), where area is the bulb's on-screen footprint in framebuffer pixels.
 *
 * Feedback comes from frame intervals (performance.now() between frames). Those are quantised
 * by vsync and tell "too slow" apart from "fast enough" but not how much headroom is left, so:
 *  - slow (median of the last 5 marched frames under ~51 fps): cut the budget in proportion to
 *    the overshoot and wait a few frames for the new cost to show. The first cut of a slow spell
 *    also remembers that pixel count as a limit (later cuts in the same spell are the spell
 *    still draining, not new information);
 *  - on time (over ~56 fps; a 120 Hz display reports 8 ms and counts too): grow the budget 6%
 *    a frame (3% in scale) up to 85% of the limit;
 *  - the limit relaxes, so a view that got cheaper is found again: 4% a second at first, halving
 *    each time a probe fails again soon after the last one (so a steady scene is not re-probed,
 *    and does not stutter, every few seconds), back to 4% when the view's footprint changes.
 * From any start it settles in under a second (verify.ts simulates it). Intervals over 250 ms
 * are pauses (tab switch, shader compile, GC), not load, and are ignored.
 */

export const MIN_SCALE = 0.35
export const MAX_SCALE = 1

const TARGET_MS = 1000 / 60
const SLOW_MS = 19.5
const FAST_MS = 17.8
const WINDOW = 5
const HOLD_FRAMES = 4
const GROW = 1.06
const LIMIT_MARGIN = 0.85
/** limit relaxation per second: initial, and the floor of the backoff */
const RELAX_PER_S = 0.04
const MIN_RELAX_PER_S = 0.0025
/** a failed probe within this long of the previous cut halves the relaxation */
const BACKOFF_WINDOW_MS = 20000
/** a change of the footprint by this factor counts as a new view */
const NEW_VIEW = 1.5
const STALL_MS = 250
/** no point growing the budget far past what the current view can use */
const BUDGET_HEADROOM = 1.3
const MIN_BUDGET = 2e4
/** a march while the view is still may take this many frame budgets (one long frame at rest) */
const REST_FACTOR = 5

/** what the last instance learned, so the next visit starts there */
let learnedBudget = 0

export class ResolutionGovernor {
  minScale = MIN_SCALE
  maxScale = MAX_SCALE
  /** march pixels per frame that fit in the frame budget */
  budget: number
  /** a pixel count that was too slow (relaxes over time) */
  private limit = Infinity
  private readonly ring = new Float64Array(WINDOW)
  private readonly sorted = new Float64Array(WINDOW)
  private count = 0
  private head = 0
  private hold = 0
  /** inside a slow spell: cuts since the last on-time decision */
  private cutting = false
  private relax = RELAX_PER_S
  /** ms since the last cut, and the footprint the relaxation was last reset for */
  private sinceCut = Infinity
  private viewArea = 0

  constructor(initialBudget = 6e5) {
    this.budget = learnedBudget > 0 ? learnedBudget : initialBudget
  }

  /** Scale (per axis) for a march over `area` framebuffer pixels while the view is moving. */
  scaleFor(area: number): number {
    return this.clampScale(Math.sqrt(this.budget / Math.max(1, area)))
  }

  /** Scale for the one march made once the view has come to rest. */
  restScaleFor(area: number): number {
    return this.clampScale(Math.sqrt((this.budget * REST_FACTOR) / Math.max(1, area)))
  }

  /**
   * The interval (ms) that followed a frame which marched `pixels` (= scale² · area) while
   * moving. `area` is that frame's footprint at scale 1.
   */
  sample(intervalMs: number, pixels: number, area: number): void {
    if (!(intervalMs > 0) || intervalMs > STALL_MS) {
      this.count = 0
      return
    }
    if (!(area > this.viewArea / NEW_VIEW && area < this.viewArea * NEW_VIEW)) {
      this.viewArea = area
      this.relax = RELAX_PER_S
    }
    this.sinceCut += intervalMs
    if (this.limit !== Infinity) this.limit *= 1 + (this.relax * intervalMs) / 1000
    this.ring[this.head] = intervalMs
    this.head = (this.head + 1) % WINDOW
    if (this.count < WINDOW) this.count++
    if (this.hold > 0) {
      this.hold--
      return
    }
    if (this.count < WINDOW) return
    const med = this.median()
    if (med > SLOW_MS) {
      if (!this.cutting) {
        // a probe that failed again soon after the last one: probe half as often
        if (this.sinceCut < BACKOFF_WINDOW_MS) this.relax = Math.max(MIN_RELAX_PER_S, this.relax / 2)
        this.limit = Math.min(this.limit, pixels)
        this.sinceCut = 0
        this.cutting = true
      }
      // cost ~ pixels: aim a little under the target, never cut by more than 2/3 at once
      const factor = Math.min(0.85, Math.max(0.36, (TARGET_MS * 0.9) / med))
      this.budget = Math.max(MIN_BUDGET, Math.min(this.budget, pixels) * factor)
      this.hold = HOLD_FRAMES
      this.count = 0
    } else if (med < FAST_MS) {
      this.cutting = false
      const cap = Math.min(this.limit * LIMIT_MARGIN, area * this.maxScale * this.maxScale * BUDGET_HEADROOM)
      if (this.budget < cap) this.budget = Math.min(cap, this.budget * GROW)
    }
    learnedBudget = this.budget
  }

  /** Forget the recent intervals (after a pause or a jump in what is drawn). */
  reset(): void {
    this.count = 0
    this.hold = 0
  }

  private clampScale(s: number): number {
    const lo = Math.min(this.minScale, this.maxScale)
    return Math.min(this.maxScale, Math.max(lo, s))
  }

  private median(): number {
    const a = this.sorted
    a.set(this.ring)
    // insertion sort of 5
    for (let i = 1; i < WINDOW; i++) {
      const v = a[i]
      let j = i - 1
      while (j >= 0 && a[j] > v) {
        a[j + 1] = a[j]
        j--
      }
      a[j + 1] = v
    }
    return a[WINDOW >> 1]
  }
}
