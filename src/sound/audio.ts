/**
 * Sound for the film: the narrator, a score that changes with the act, recorded effects, and
 * small synthesised notes for things that tick, drip and flash on screen.
 *
 *   voice  one narration segment at a time, streamed (an <audio> element routed into the graph)
 *   music  one looping bed per act, cross-faded, ducked under the voice
 *   sfx    effects in the score's own language: breaths of filtered air and soft knocks, made
 *          here and sent through the hall, so nothing is sharper or brighter than the music.
 *          Only sounds of real things (a water drop) are recordings.
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

  /** start fetching and decoding a recorded effect: public/sfx/<name>.mp3 */
  prefetch(name: string) {
    if (name === 'drip') void this.buffer(`sfx/${name}.mp3`)
  }

  /**
   * Play an effect by name. `gain` scales it, `rate` shifts its pitch (recordings and knocks),
   * `pan` is −1..1.
   *
   *   shimmer  a short breath rising: something changes shape
   *   rise     a long breath rising: a reveal
   *   release  a long breath falling away: something let go
   *   fold     a low breath turning over
   *   split    two soft knocks, the second lower: a parting
   *   tick     one soft knock          turn  a lower one
   *   drip     a water drop (recorded)
   */
  sfx(name: string, gain = 1, rate = 1, pan = 0) {
    switch (name) {
      case 'shimmer':
        return this.breath({ seconds: 1.5, from: 380, to: 900, gain: 0.5 * gain, pan })
      case 'rise':
        return this.breath({ seconds: 3.4, from: 230, to: 760, gain: 0.5 * gain, pan })
      case 'release':
        return this.breath({ seconds: 3.0, from: 620, to: 240, gain: 0.7 * gain, pan })
      case 'fold':
        return this.breath({ seconds: 2.8, from: 460, to: 190, gain: 0.6 * gain, pan })
      case 'split':
        this.knock(430 * rate, 0.5 * gain, pan - 0.25)
        return this.knock(320 * rate, 0.4 * gain, pan + 0.25, 0.16)
      case 'tick':
        return this.knock(300 * rate, 0.6 * gain, pan)
      case 'turn':
        return this.knock(220 * rate, 0.6 * gain, pan)
      default:
        return this.recorded(name, gain, rate, pan)
    }
  }

  /** a recorded one-shot: public/sfx/<name>.mp3 */
  private recorded(name: string, gain: number, rate: number, pan: number) {
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
      // take the edge off: nothing in the film is brighter than its music
      const soften = ctx.createBiquadFilter()
      soften.type = 'lowpass'
      soften.frequency.value = 3200
      src.connect(soften).connect(g).connect(p).connect(out)
      if (this.reverb) {
        const send = ctx.createGain()
        send.gain.value = 0.5
        p.connect(send).connect(this.reverb)
      }
      src.start()
    })
  }

  /**
   * A breath: air through a slowly moving band-pass, swelling and dying away, mostly heard as
   * its tail in the hall. No attack, no pitch, nothing above a couple of kilohertz.
   */
  private breath(o: { seconds: number; from: number; to: number; gain: number; pan?: number }) {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.reverb || ctx.state !== 'running') return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx)
    src.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 0.8
    band.frequency.setValueAtTime(o.from, t)
    band.frequency.exponentialRampToValueAtTime(o.to, t + o.seconds)
    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(o.gain, t + o.seconds * 0.42)
    g.gain.linearRampToValueAtTime(0.0001, t + o.seconds)
    const p = ctx.createStereoPanner()
    p.pan.value = o.pan ?? 0
    src.connect(band).connect(dark).connect(g).connect(p)
    const dry = ctx.createGain()
    dry.gain.value = 0.45
    p.connect(dry).connect(this.sfxBus)
    const send = ctx.createGain()
    send.gain.value = 0.9
    p.connect(send).connect(this.reverb)
    src.start(t)
    src.stop(t + o.seconds + 0.05)
  }

  /** A soft knock: a few milliseconds of air through a resonant band, like a felt mallet on wood. */
  private knock(freq: number, gain: number, pan = 0, delay = 0) {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.reverb || ctx.state !== 'running') return
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx)
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = freq
    band.Q.value = 5
    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 1200
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    src.connect(band).connect(dark).connect(g).connect(p)
    p.connect(this.sfxBus)
    const send = ctx.createGain()
    send.gain.value = 0.7
    p.connect(send).connect(this.reverb)
    src.start(t, Math.random() * 1.5)
    src.stop(t + 0.3)
  }

  private noise: AudioBuffer | null = null
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const n = ctx.sampleRate * 2
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
      this.noise = buf
    }
    return this.noise
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
