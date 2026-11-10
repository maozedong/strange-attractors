/**
 * Sound for the film: the narrator, a score that changes with the act, recorded effects, and
 * small synthesised notes for things that tick, drip and flash on screen.
 *
 *   voice  one narration segment at a time, streamed (an <audio> element routed into the graph)
 *   music  one looping bed per act, cross-faded, ducked under the voice
 *   sfx    decoded one-shots
 *   notes  sine plucks through a shared reverb, for sonifying what a scene is doing
 *
 * Browsers only start audio inside a gesture: `arm()` starts the context on the first tap, click
 * or key anywhere. On iPhone, Web Audio follows the ring/silent switch unless the page asks for
 * a playback session, so that is requested before the context is made.
 */
const BASE = import.meta.env.BASE_URL

const LEVEL = { voice: 1, music: 0.5, sfx: 0.7, notes: 0.5 }
/** music level while the narrator is speaking */
const DUCK = 0.42
const MUTE_KEY = 'strange-attractors:muted'

type Listener = () => void

export interface VoiceClip {
  /** resolves once enough is buffered to start (or the wait timed out) */
  ready: Promise<void>
  play(offset?: number): void
  pause(): void
  stop(): void
  /** seconds into the clip, or NaN when it is not playing */
  readonly time: number
  readonly playing: boolean
}

class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private voiceBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noteBus: GainNode | null = null
  private reverb: ConvolverNode | null = null
  private armed = false
  private mutedNow = false
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private voiceEls = new Map<string, HTMLAudioElement>()
  private wired = new WeakSet<HTMLAudioElement>()
  private speaking: HTMLAudioElement | null = null
  private music: { el: HTMLAudioElement; gain: GainNode; id: string } | null = null
  private musicWanted: string | null = null
  private listeners = new Set<Listener>()
  private silent: HTMLAudioElement | null = null

  constructor() {
    try {
      this.mutedNow = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      /* private mode */
    }
  }

  /** 'locked' before any gesture, 'running' when sound can be heard */
  get state(): 'locked' | 'running' | 'suspended' {
    if (!this.ctx) return 'locked'
    return this.ctx.state === 'running' ? 'running' : 'suspended'
  }

  get muted() {
    return this.mutedNow
  }

  get context() {
    return this.ctx
  }

  /** the narrator's signal, for scenes that draw it */
  get voiceTap(): AudioNode | null {
    return this.voiceBus
  }

  /** everything audible passes through here (synthesised extras connect to it) */
  get output(): AudioNode | null {
    return this.master
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** start listening for the first gesture; call once at startup */
  arm() {
    if (this.armed) return
    this.armed = true
    this.requestPlayback()
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

  /** must run inside a user gesture the first time */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.requestPlayback()
      const ctx = new Ctor({ latencyHint: 'interactive' })
      this.ctx = ctx
      const master = ctx.createGain()
      master.gain.value = this.mutedNow ? 0 : 1
      // a gentle limiter so layered sound never clips
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 6
      limiter.ratio.value = 6
      limiter.attack.value = 0.005
      limiter.release.value = 0.2
      master.connect(limiter).connect(ctx.destination)
      this.master = master
      const bus = (level: number) => {
        const g = ctx.createGain()
        g.gain.value = level
        g.connect(master)
        return g
      }
      this.voiceBus = bus(LEVEL.voice)
      this.musicBus = bus(LEVEL.music)
      this.sfxBus = bus(LEVEL.sfx)
      this.noteBus = bus(LEVEL.notes)
      this.reverb = ctx.createConvolver()
      this.reverb.buffer = this.impulse(ctx, 3.2)
      const wet = ctx.createGain()
      wet.gain.value = 0.5
      this.reverb.connect(wet).connect(this.noteBus)
      ctx.onstatechange = () => this.emit()
      if (this.musicWanted) this.startMusic(this.musicWanted)
      this.emit()
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.emit())
    this.playSilent()
  }

  setMuted(muted: boolean) {
    this.mutedNow = muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* private mode */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05)
    this.emit()
  }

  // ───────────── narration ─────────────

  /** start fetching a narration segment ahead of time */
  preloadVoice(stem: string) {
    this.voiceEl(stem)
  }

  voice(stem: string): VoiceClip {
    const el = this.voiceEl(stem)
    const ready = new Promise<void>((resolve) => {
      if (el.readyState >= 3) return resolve()
      const done = () => {
        el.removeEventListener('canplay', done)
        el.removeEventListener('error', done)
        resolve()
      }
      el.addEventListener('canplay', done)
      el.addEventListener('error', done)
      window.setTimeout(done, 2500)
    })
    const self = this
    return {
      ready,
      play(offset = 0) {
        self.wire(el)
        try {
          if (Math.abs(el.currentTime - offset) > 0.05) el.currentTime = offset
        } catch {
          /* not seekable yet */
        }
        self.speaking = el
        void el.play().catch(() => undefined)
        self.duck(true)
      },
      pause() {
        el.pause()
        if (self.speaking === el) self.duck(false)
      },
      stop() {
        el.pause()
        if (self.speaking === el) {
          self.speaking = null
          self.duck(false)
        }
      },
      get time() {
        return el.paused || el.error ? NaN : el.currentTime
      },
      get playing() {
        return !el.paused && !el.ended
      },
    }
  }

  // ───────────── music ─────────────

  /** cross-fade to a music bed: public/music/<id>.mp3 (missing files are simply silent) */
  setMusic(id: string | null) {
    this.musicWanted = id
    if (!this.ctx) return
    if (id) this.startMusic(id)
    else this.fadeOutMusic(2.5)
  }

  // ───────────── effects and notes ─────────────

  /** start fetching and decoding an effect: public/sfx/<name>.mp3 */
  prefetch(name: string) {
    void this.buffer(`sfx/${name}.mp3`)
  }

  /** play a recorded effect */
  sfx(name: string, gain = 1, rate = 1, pan = 0) {
    if (!this.ctx || !this.sfxBus) return
    const ctx = this.ctx
    const out = this.sfxBus
    void this.buffer(`sfx/${name}.mp3`).then((buf) => {
      if (!buf) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate
      const g = ctx.createGain()
      g.gain.value = gain
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      src.connect(g).connect(p).connect(out)
      src.start()
    })
  }

  /**
   * A soft plucked sine, for making what happens on screen audible: a drip, a tick, a flash.
   * `pan` −1..1, `seconds` is the decay.
   */
  note(freq: number, opts: { gain?: number; seconds?: number; pan?: number; wet?: number; type?: OscillatorType } = {}) {
    const ctx = this.ctx
    if (!ctx || !this.noteBus || !this.reverb || ctx.state !== 'running') return
    const t = ctx.currentTime
    const seconds = opts.seconds ?? 0.6
    const osc = ctx.createOscillator()
    osc.type = opts.type ?? 'sine'
    osc.frequency.value = freq
    const g = ctx.createGain()
    const peak = (opts.gain ?? 0.2) * 0.5
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    const p = ctx.createStereoPanner()
    p.pan.value = opts.pan ?? 0
    osc.connect(g).connect(p)
    p.connect(this.noteBus)
    const send = ctx.createGain()
    send.gain.value = opts.wet ?? 0.6
    p.connect(send).connect(this.reverb)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
  }

  // ───────────── internals ─────────────

  private emit() {
    for (const l of this.listeners) l()
  }

  private requestPlayback() {
    if (typeof navigator === 'undefined' || !('audioSession' in navigator)) return
    try {
      ;(navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback'
    } catch {
      /* read-only in some builds */
    }
  }

  /** older iOS: playing a real silent file from the gesture moves Web Audio off the ringer */
  private playSilent() {
    if ('audioSession' in navigator || this.silent) return
    if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return
    const el = new Audio(`${BASE}audio/silence.wav`)
    el.loop = true
    el.setAttribute('playsinline', '')
    this.silent = el
    void el.play().catch(() => {
      this.silent = null
    })
  }

  private voiceEl(stem: string): HTMLAudioElement {
    let el = this.voiceEls.get(stem)
    if (!el) {
      el = new Audio()
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.setAttribute('playsinline', '')
      el.src = `${BASE}vo/${stem}.mp3`
      this.voiceEls.set(stem, el)
      // keep the cache small: narration is streamed, not hoarded
      if (this.voiceEls.size > 8) {
        const [oldest] = this.voiceEls.keys()
        const old = this.voiceEls.get(oldest)
        if (old && old !== this.speaking) {
          old.removeAttribute('src')
          this.voiceEls.delete(oldest)
        }
      }
    }
    return el
  }

  /** route an element through the graph (once the context exists) */
  private wire(el: HTMLAudioElement) {
    if (!this.ctx || !this.voiceBus || this.wired.has(el)) return
    try {
      this.ctx.createMediaElementSource(el).connect(this.voiceBus)
      this.wired.add(el)
    } catch {
      /* already wired by an earlier context */
    }
  }

  private duck(on: boolean) {
    if (!this.ctx || !this.musicBus) return
    this.musicBus.gain.setTargetAtTime(LEVEL.music * (on ? DUCK : 1), this.ctx.currentTime, on ? 0.25 : 0.9)
  }

  private startMusic(id: string) {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    if (this.music?.id === id) return
    this.fadeOutMusic(3)
    const el = new Audio(`${BASE}music/${id}.mp3`)
    el.loop = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.setAttribute('playsinline', '')
    const gain = ctx.createGain()
    gain.gain.value = 0
    try {
      ctx.createMediaElementSource(el).connect(gain).connect(this.musicBus)
    } catch {
      return
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime + 0.3, 1.4)
    void el.play().catch(() => undefined)
    this.music = { el, gain, id }
  }

  private fadeOutMusic(seconds: number) {
    const m = this.music
    if (!m || !this.ctx) return
    this.music = null
    m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, seconds / 3)
    window.setTimeout(() => {
      m.el.pause()
      m.el.removeAttribute('src')
    }, seconds * 1000 + 500)
  }

  private buffer(path: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(path)
    if (!p) {
      p = fetch(`${BASE}${path}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((a) => (a && this.ctx ? this.ctx.decodeAudioData(a) : null))
        .catch(() => null)
      this.buffers.set(path, p)
      // decoding needs the context: forget a miss made before the first gesture
      void p.then((b) => {
        if (!b && !this.ctx) this.buffers.delete(path)
      })
    }
    return p
  }

  /** a soft hall: filtered noise with an exponential tail */
  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let last = 0
      for (let i = 0; i < n; i++) {
        const t = i / n
        const white = Math.random() * 2 - 1
        // one-pole low-pass that closes as the tail decays: the hall gets darker, not just quieter
        const a = 0.25 + 0.6 * t
        last = last * a + white * (1 - a)
        d[i] = last * Math.pow(1 - t, 2.6)
      }
    }
    return buf
  }
}

export const sound = new Sound()
