/**
 * The director runs a chapter's autoplay: a list of cues, each tied to a phrase of the
 * narration script (or a plain number of seconds), fired when the narration reaches that
 * phrase. Timings come from the forced-alignment files next to the audio
 * (public/audio/vo-<id>.json); when a file is missing the time is estimated from the
 * phrase's position in the script. Narration may be muted or off: the cues still run
 * on the same clock, so the pictures play themselves either way.
 *
 * Cues must be idempotent and respect what the visitor has already done by hand
 * (check state before acting); tweens are tagged so a manual change can cancel them.
 */
import { audio } from '../audio/engine'
import { NARRATION } from '../audio/script'
import { useStore, type AppState } from '../store'

export interface Cue {
  /** phrase of the narration script (exact substring) or seconds from the start */
  at: string | number
  /** optional offset in seconds applied on top of `at` */
  delay?: number
  run: (store: AppState, director: Director) => void
}

interface Scheduled {
  at: string | number
  time: number
  fired: boolean
  run: Cue['run']
}

interface Tween {
  tag: string
  start: number
  seconds: number
  from: number
  to: number
  apply: (v: number) => void
  ease: (t: number) => number
  done?: () => void
}

/** seconds per character of narration when no alignment file is available (measured ≈ 0.07) */
const SECONDS_PER_CHAR = 0.07

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const linear = (t: number) => t

const alignments = new Map<string, Promise<number[] | null>>()

function loadAlignment(id: string): Promise<number[] | null> {
  let p = alignments.get(id)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}audio/vo-${id}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { t?: number[] } | null) => (j?.t ? j.t : null))
      .catch(() => null)
    alignments.set(id, p)
  }
  return p
}

export class Director {
  private chapterId: string | null = null
  private scheduled: Scheduled[] = []
  private tweens: Tween[] = []
  /** performance.now() corresponding to narration time 0 */
  private origin = 0
  private raf = 0
  private generation = 0
  private running = false

  /** seconds since the chapter's narration started (or would have) */
  get time() {
    return this.running ? (performance.now() - this.origin) / 1000 : 0
  }

  /**
   * Start a chapter's autoplay. Resolves the cue times, starts narration (the engine
   * decides whether it is audible) and re-bases the clock on the moment the voice
   * actually starts so phrases and pictures line up.
   */
  async play(id: string, cues: Cue[] | undefined, narrate = true) {
    this.stop()
    const gen = ++this.generation
    this.chapterId = id
    const script = NARRATION[id]
    const align = script ? await loadAlignment(id) : null
    if (gen !== this.generation) return
    this.scheduled = (cues ?? []).map((c) => ({ at: c.at, time: resolveTime(c, script, align), fired: false, run: c.run }))
    this.origin = performance.now()
    this.running = true
    this.tick()
    if (narrate && script) {
      const startedAt = await audio.narrate(id)
      if (gen !== this.generation) return
      // the voice started `startedAt` ms ago (negative = scheduled ahead); re-base
      if (startedAt !== null) this.origin = startedAt
    }
  }

  /** Resolved time (seconds) of a scheduled cue, by its phrase or number; NaN if unknown. */
  timeOf(at: string | number): number {
    const c = this.scheduled.find((x) => x.at === at)
    return c ? c.time : NaN
  }

  /** Re-run the current chapter from the top (used by "Replay"). */
  replay(onEnter: (s: AppState) => void, cues: Cue[] | undefined) {
    const id = this.chapterId
    if (!id) return
    this.stop()
    onEnter(useStore.getState())
    void this.play(id, cues)
  }

  stop() {
    this.generation++
    this.running = false
    this.scheduled = []
    this.tweens = []
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** Animate a number; `tag` lets a manual change cancel it with `cancel(tag)`. */
  tween(
    tag: string,
    from: number,
    to: number,
    seconds: number,
    apply: (v: number) => void,
    ease: (t: number) => number = easeInOut,
    done?: () => void,
  ) {
    this.cancel(tag)
    this.tweens.push({ tag, start: performance.now(), seconds, from, to, apply, ease, done })
    if (!this.running && !this.raf) this.tick()
  }

  cancel(tag: string) {
    this.tweens = this.tweens.filter((t) => t.tag !== tag)
  }

  hasTween(tag: string) {
    return this.tweens.some((t) => t.tag === tag)
  }

  private tick = () => {
    this.raf = 0
    const now = performance.now()
    if (this.running) {
      const t = (now - this.origin) / 1000
      const store = useStore.getState()
      for (const c of this.scheduled) {
        if (!c.fired && t >= c.time) {
          c.fired = true
          try {
            c.run(store, this)
          } catch (e) {
            console.error('[director] cue failed', e)
          }
        }
      }
    }
    if (this.tweens.length) {
      const keep: Tween[] = []
      for (const tw of this.tweens) {
        const u = Math.min(1, (now - tw.start) / (tw.seconds * 1000))
        tw.apply(tw.from + (tw.to - tw.from) * tw.ease(u))
        if (u < 1) keep.push(tw)
        else tw.done?.()
      }
      this.tweens = keep
    }
    const pending = this.scheduled.some((c) => !c.fired)
    if ((this.running && pending) || this.tweens.length) this.raf = requestAnimationFrame(this.tick)
  }
}

function resolveTime(cue: Cue, script: string | undefined, align: number[] | null): number {
  const delay = cue.delay ?? 0
  if (typeof cue.at === 'number') return cue.at + delay
  if (!script) return delay
  const idx = script.indexOf(cue.at)
  if (idx < 0) {
    console.warn(`[director] phrase not in script: "${cue.at}"`)
    return delay
  }
  if (align && idx < align.length) return align[idx] + delay
  return idx * SECONDS_PER_CHAR + delay
}

export const director = new Director()
