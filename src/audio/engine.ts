/**
 * One small Web Audio engine for the whole app: a looping ambient bed, one narration voice
 * at a time (ducking the bed while it speaks), and short one-shot effects. Everything is
 * pre-rendered into /audio/*.mp3, so there is no API key or network dependency at runtime.
 *
 * Getting sound out of a phone needs two things, and this file does both in one place:
 *
 *  1. An AudioContext may only start inside a user gesture. `armAutoUnlock()` listens for
 *     the first activating gesture anywhere on the page (tap, click, key) and starts the
 *     context there, so it does not matter which button the visitor uses to enter.
 *
 *  2. On iOS, Web Audio plays through the ringer channel by default, which the ring/silent
 *     switch mutes; that is the usual reason a working audio graph is inaudible on an
 *     iPhone. The fix is to ask for a "playback" audio session: `navigator.audioSession`
 *     (Safari 17+) does that directly, and on older iOS playing a real silent media file
 *     from the gesture moves the session the same way.
 */

type Bus = 'ambient' | 'voice' | 'sfx'

interface AudioSessionLike {
  type: string
}

function hasAudioSession(): boolean {
  return typeof navigator !== 'undefined' && 'audioSession' in navigator
}

/**
 * Ask iOS for a playback session (Safari 17+): sound then ignores the ring/silent switch,
 * like a music app. Safe to call anywhere; a no-op elsewhere.
 */
function requestPlaybackSession() {
  if (!hasAudioSession()) return
  try {
    ;(navigator as unknown as { audioSession: AudioSessionLike }).audioSession.type = 'playback'
  } catch {
    /* read-only in some builds */
  }
}

const LEVELS: Record<Bus, number> = { ambient: 0.35, voice: 1.0, sfx: 0.7 }
/** ambient level while narration is speaking */
const DUCK = 0.4

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: Record<Bus, GainNode> | null = null
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private narration: { source: AudioBufferSourceNode; id: string } | null = null
  private ambientSource: AudioBufferSourceNode | null = null
  private muted = false
  private narrationOn = true
  private ambientWanted = false
  private autoUnlockArmed = false
  /** the fallback silent element, kept only until its play() has succeeded once */
  private sessionElement: HTMLAudioElement | null = null
  private sessionReady = false

  get unlocked() {
    return this.ctx !== null
  }

  /** how the iOS audio session is being handled, for diagnostics */
  get sessionInfo(): string {
    if (hasAudioSession()) return `audioSession=${(navigator as unknown as { audioSession: AudioSessionLike }).audioSession.type}`
    return this.sessionReady ? 'silent-element played' : 'silent-element pending'
  }

  /** 'locked' before any gesture, 'running' when sound can be heard, 'suspended' otherwise */
  get state(): 'locked' | 'running' | 'suspended' {
    if (!this.ctx) return 'locked'
    return this.ctx.state === 'running' ? 'running' : 'suspended'
  }

  /**
   * Unlock on the first activating gesture anywhere (only `touchend`, `click` and `keydown`
   * count as activation on every browser; a touch `pointerdown` does not), and resume after
   * the page comes back from the background. Call once at startup.
   */
  armAutoUnlock() {
    if (this.autoUnlockArmed || typeof window === 'undefined') return
    this.autoUnlockArmed = true
    requestPlaybackSession()
    const gesture = () => this.unlock()
    for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, gesture, { capture: true, passive: true })
    const wake = () => {
      if (document.visibilityState === 'hidden') return
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
  }

  /** the AudioContext, once unlocked (null before any user gesture) */
  get context(): AudioContext | null {
    return this.ctx
  }

  /** the node every narration source feeds; connect an AnalyserNode here to listen in */
  get voiceTap(): AudioNode | null {
    return this.bus?.voice ?? null
  }

  /** master gain, for feeding synthesized sound through the mute switch */
  get masterNode(): AudioNode | null {
    return this.master
  }

  /** Call from a user gesture. Idempotent. */
  unlock() {
    this.ensurePlaybackSession()
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    requestPlaybackSession()
    const ctx = new Ctx()
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 1
    master.connect(ctx.destination)
    const mk = (b: Bus) => {
      const g = ctx.createGain()
      g.gain.value = LEVELS[b]
      g.connect(master)
      return g
    }
    this.ctx = ctx
    this.master = master
    this.bus = { ambient: mk('ambient'), voice: mk('voice'), sfx: mk('sfx') }
    void ctx.resume()
    // warm the cache for the sounds that fire on interaction
    for (const n of ['sfx-turn', 'sfx-release', 'sfx-shimmer', 'sfx-split', 'sfx-ambient']) void this.load(n)
    if (this.ambientWanted) void this.startAmbient()
  }

  /**
   * Older iOS (before navigator.audioSession): playing a real silent file from the gesture
   * puts the page in a playback session, which the ring/silent switch does not mute.
   * Retried on every gesture until a play() has actually succeeded.
   */
  private ensurePlaybackSession() {
    if (this.sessionReady || hasAudioSession()) return
    try {
      if (!this.sessionElement) {
        const el = document.createElement('audio')
        el.setAttribute('playsinline', '')
        el.preload = 'auto'
        el.src = `${import.meta.env.BASE_URL}audio/silence.wav`
        el.volume = 0.01
        this.sessionElement = el
      }
      const p = this.sessionElement.play()
      if (p)
        p.then(
          () => {
            this.sessionReady = true
          },
          () => {},
        )
    } catch {
      /* not available */
    }
  }

  /** Fetch and decode once; a missing file resolves to null and is never retried. */
  load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name)
    if (p) return p
    p = (async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}audio/${name}.mp3`)
        if (!r.ok) return null
        const data = await r.arrayBuffer()
        if (!this.ctx) return null
        return await this.ctx.decodeAudioData(data)
      } catch {
        return null
      }
    })()
    this.buffers.set(name, p)
    return p
  }

  /** Prefetch without playing (e.g. the next chapter's narration). */
  prefetch(name: string) {
    if (this.ctx) void this.load(name)
  }

  setMuted(m: boolean) {
    this.muted = m
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.08)
  }

  setNarrationEnabled(on: boolean) {
    this.narrationOn = on
    if (!on) this.stopNarration()
  }

  /**
   * Play the narration for a chapter id (stops any other narration first).
   * Resolves with the performance.now() timestamp at which the voice starts, or null
   * when nothing will be heard (audio locked, narration off, file missing).
   */
  async narrate(id: string): Promise<number | null> {
    this.stopNarration()
    if (!this.ctx || !this.bus || !this.narrationOn) return null
    const buf = await this.load(`vo-${id}`)
    // the chapter may have changed while decoding
    if (!buf || !this.ctx || !this.narrationOn || this.narration) return null
    const source = this.ctx.createBufferSource()
    source.buffer = buf
    source.connect(this.bus.voice)
    const rec = { source, id }
    this.narration = rec
    this.duck(true)
    source.onended = () => {
      if (this.narration === rec) {
        this.narration = null
        this.duck(false)
      }
    }
    // start a hair in the future so the returned timestamp is exact
    const lead = 0.05
    const when = this.ctx.currentTime + lead
    source.start(when)
    return performance.now() + lead * 1000
  }

  stopNarration() {
    if (!this.narration) return
    const { source } = this.narration
    this.narration = null
    try {
      source.stop()
    } catch {
      /* already stopped */
    }
    this.duck(false)
  }

  get speaking(): string | null {
    return this.narration?.id ?? null
  }

  /** One-shot effect; `gain` scales the sfx bus level for this hit. */
  async sfx(name: string, gain = 1) {
    if (!this.ctx || !this.bus) return
    const buf = await this.load(`sfx-${name}`)
    if (!buf || !this.ctx) return
    const source = this.ctx.createBufferSource()
    source.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = gain
    source.connect(g)
    g.connect(this.bus.sfx)
    source.start()
  }

  setAmbient(on: boolean) {
    this.ambientWanted = on
    if (!this.ctx) return
    if (on) void this.startAmbient()
    else this.stopAmbient()
  }

  private async startAmbient() {
    if (this.ambientSource || !this.ctx || !this.bus) return
    const buf = await this.load('sfx-ambient')
    if (!buf || !this.ctx || this.ambientSource || !this.ambientWanted) return
    const source = this.ctx.createBufferSource()
    source.buffer = buf
    source.loop = true
    source.connect(this.bus.ambient)
    this.ambientSource = source
    const g = this.bus.ambient.gain
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(0, t)
    g.linearRampToValueAtTime(this.narration ? LEVELS.ambient * DUCK : LEVELS.ambient, t + 2.5)
    source.start()
  }

  private stopAmbient() {
    const s = this.ambientSource
    if (!s || !this.ctx || !this.bus) return
    this.ambientSource = null
    const g = this.bus.ambient.gain
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(0, t, 0.5)
    s.stop(t + 2)
  }

  private duck(on: boolean) {
    if (!this.ctx || !this.bus || !this.ambientSource) return
    const g = this.bus.ambient.gain
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(on ? LEVELS.ambient * DUCK : LEVELS.ambient, t, 0.4)
  }
}

export const audio = new AudioEngine()
