import {
  PITCH_MIN_RMS,
  PitchEstimator,
  RoughnessMeter,
  WINDOW,
  clamp,
  embedRing,
  freshSamples,
  mean,
  rmsAbout,
  smoothstep,
} from './dsp'
import { BEAM_REF } from './look'

/** points on the drawn curve (about 1.5 analyser windows) */
export const POINTS = 6000
/** continuous signal kept for the embedding; a power of two ≥ POINTS + 2·MAX_LAG */
export const HISTORY = 8192
/** longest embedding delay in samples (21 ms at 48 kHz) */
export const MAX_LAG = 1024

/** the attractor's auto gain never amplifies a signal whose recent peak is below this */
export const AMP_FLOOR = 0.02
/** level reference for quiet inputs: a voice at this RMS or below never reads full level */
const LEVEL_REF_MIN = 0.01
/** release time constants (s) of the level reference and of the amplitude peak */
const RMS_RELEASE = 3
const AMP_RELEASE = 1.7
/** absolute gate on the RMS (digital silence, a muted mic) */
const GATE_LO = 0.0005
const GATE_HI = 0.0015
/** microphone noise floor: falls quickly, rises 3 dB/s and only while nothing periodic is heard */
const FLOOR_INIT = 0.001
const FLOOR_MAX = 0.008
const FLOOR_FALL = 0.15
const FLOOR_RISE = Math.log(Math.pow(10, 3 / 20))
const FLOOR_CLARITY = 0.6
/** smoothing time constant (s) of the roughness, which only moves while there is sound */
const ROUGH_TAU = 0.3
/** DC blocker on the stored signal, Hz */
const DC_CUTOFF = 8
/** level below which the stage counts as quiet */
export const QUIET_LEVEL = 0.02

/**
 * Everything measured from one input: the continuous signal (stitched from overlapping
 * analyser reads), the level, the pitch, the roughness, and the slow followers that drive
 * the auto gain. One per AudioContext sample rate; all buffers allocated here.
 */
export class VoiceAnalysis {
  readonly sampleRate: number
  /** the caller fills this with AnalyserNode.getFloatTimeDomainData before ingest() */
  readonly win: Float32Array<ArrayBuffer> = new Float32Array(WINDOW)
  /** the continuous signal, DC-blocked; the newest sample is at hist[(histHead − 1) & mask] */
  readonly hist = new Float32Array(HISTORY)
  histHead = 0
  /** valid samples in `hist` */
  histCount = 0

  /** AC RMS of the last window */
  rms = 0
  /** Hz, 0 when silent or not periodic */
  pitch = 0
  /** periodicity of the last window, 0..1 */
  clarity = 0
  /** share of the last window's energy above 2 kHz */
  hf = 0
  /** 0..1, soft auto-gained level */
  level = 0
  /** smoothed sqrt(hf), 0 = a clean loop, 1 = noise */
  roughness = 0
  /** peak |sample| follower (instant attack, slow release) for the embedding's auto gain */
  ampPeak = 0
  /** RMS follower, the level's reference */
  rmsPeak = 0
  /** microphone noise floor estimate (RMS); used only when `adaptiveFloor` */
  noiseFloor = FLOOR_INIT
  /** 0..1, how far the input is above the noise gate */
  gate = 0
  /** seconds the level has stayed below QUIET_LEVEL */
  quietTime = 0
  /** track the room's noise floor (microphone input) instead of only gating digital silence */
  adaptiveFloor = false

  private readonly prev = new Float32Array(WINDOW)
  private hasPrev = false
  private lastTime = 0
  private serial = -1
  private live = false
  private framePeak = 0
  private dcX = 0
  private dcY = 0
  private readonly dcR: number
  private readonly pitchEst: PitchEstimator
  private readonly roughMeter: RoughnessMeter

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.dcR = 1 - (2 * Math.PI * DC_CUTOFF) / sampleRate
    this.pitchEst = new PitchEstimator(sampleRate, WINDOW)
    this.roughMeter = new RoughnessMeter(sampleRate)
  }

  /** index of the newest stored sample */
  get newest(): number {
    return (this.histHead - 1) & (HISTORY - 1)
  }

  /** Forget the stored signal (a new input, or a gap the reads could not bridge). */
  reset(): void {
    this.histHead = 0
    this.histCount = 0
    this.hasPrev = false
  }

  /**
   * `win` holds a fresh analyser read taken at context time `time`; `serial` changes whenever
   * a different node feeds the analyser. Appends what is new and measures the window.
   */
  ingest(serial: number, time: number): void {
    if (serial !== this.serial) {
      // a different input: its loudness has nothing to do with the last one's, so the auto
      // gain starts over (instant attack picks the new level up from this very read)
      this.reset()
      this.ampPeak = 0
      this.rmsPeak = 0
      this.noiseFloor = FLOOR_INIT
      this.serial = serial
    }
    const fresh = this.hasPrev
      ? freshSamples(this.prev, this.win, WINDOW, (time - this.lastTime) * this.sampleRate)
      : WINDOW
    this.lastTime = time
    this.live = true
    if (fresh === 0) return // nothing new since the last frame; keep the last measurements
    if (fresh >= WINDOW) {
      // no overlap with the previous read: start the stored signal again
      this.histHead = 0
      this.histCount = 0
      this.dcX = this.win[0]
      this.dcY = 0
    }
    this.append(WINDOW - Math.min(fresh, WINDOW))
    this.prev.set(this.win)
    this.hasPrev = true

    const w = this.win
    const m = mean(w, WINDOW)
    this.rms = rmsAbout(w, WINDOW, m)
    this.hf = this.roughMeter.ratio(w, WINDOW, m)
    if (this.rms >= PITCH_MIN_RMS) {
      this.pitch = this.pitchEst.estimate(w, WINDOW)
      this.clarity = this.pitchEst.clarity
    } else {
      this.pitch = 0
      this.clarity = 0
    }
  }

  /** No read this frame (no input yet, or the context is not running): treat as silence. */
  idle(): void {
    this.live = false
    this.rms = 0
    this.pitch = 0
    this.clarity = 0
  }

  /** Advance the followers by `dt` seconds. Call once per frame, after ingest() or idle(). */
  follow(dt: number): void {
    const rms = this.rms
    if (this.adaptiveFloor && this.live) {
      if (rms < this.noiseFloor) this.noiseFloor += (rms - this.noiseFloor) * (1 - Math.exp(-dt / FLOOR_FALL))
      else if (this.clarity < FLOOR_CLARITY) this.noiseFloor *= Math.exp(FLOOR_RISE * dt)
      this.noiseFloor = clamp(this.noiseFloor, 1e-5, FLOOR_MAX)
    }
    const floor = this.adaptiveFloor ? this.noiseFloor : 0
    this.gate = smoothstep(GATE_LO, GATE_HI, rms) * (floor > 0 ? smoothstep(1.6 * floor, 3.2 * floor, rms) : 1)

    this.rmsPeak = Math.max(rms * this.gate, this.rmsPeak * Math.exp(-dt / RMS_RELEASE))
    this.level = clamp(rms / Math.max(this.rmsPeak, LEVEL_REF_MIN), 0, 1) * this.gate

    this.ampPeak = Math.max(this.framePeak * this.gate, this.ampPeak * Math.exp(-dt / AMP_RELEASE))
    this.framePeak = 0

    if (this.gate > 0.5) this.roughness += (Math.sqrt(this.hf) - this.roughness) * (1 - Math.exp(-dt / ROUGH_TAU))
    if (this.pitch > 0 && this.gate < 0.5) this.pitch = 0

    this.quietTime = this.level < QUIET_LEVEL ? this.quietTime + dt : 0
  }

  /**
   * Radius (in sample units) below which an embedded point counts as silence: a few times
   * the noise floor, or 3 % of the recent peak, whichever is larger.
   */
  get centreRadius(): number {
    const floor = this.adaptiveFloor ? this.noiseFloor : 0
    return Math.max(3 * Math.sqrt(3) * floor, 0.03 * this.ampPeak, 1e-6)
  }

  private append(from: number): void {
    const w = this.win
    const h = this.hist
    const mask = HISTORY - 1
    const R = this.dcR
    let x1 = this.dcX
    let y1 = this.dcY
    let head = this.histHead
    let peak = this.framePeak
    for (let i = from; i < WINDOW; i++) {
      const x = w[i]
      const y = x - x1 + R * y1
      x1 = x
      y1 = y
      h[head] = y
      head = (head + 1) & mask
      const a = y < 0 ? -y : y
      if (a > peak) peak = a
    }
    this.dcX = x1
    this.dcY = y1
    this.histHead = head
    this.histCount = Math.min(HISTORY, this.histCount + (WINDOW - from))
    this.framePeak = peak
  }
}

/**
 * The drawn curve: up to POINTS embedded points, oldest first; a brightness per point (age
 * fade × a gate that darkens points near the centre, where silence and hiss collapse); and a
 * scale per segment (the beam: long jumps get the same light as short steps, spread thinner).
 */
export class VoiceCurve {
  readonly points = new Float32Array(POINTS * 3)
  readonly brightness = new Float32Array(POINTS)
  /** segment j joins points j and j + 1 */
  readonly segment = new Float32Array(POINTS)
  count = 0
  lag = 1
  gain = 0
  private readonly lut = new Float32Array(POINTS)
  private lutCount = -1

  /** `size` as in VoiceAttractor: the loudest recent sample reaches 0.45 × size on each embedding axis. */
  update(a: VoiceAnalysis, delayMs: number, size: number): void {
    const lag = clamp(Math.round((delayMs * a.sampleRate) / 1000), 1, MAX_LAG)
    const n = Math.max(0, Math.min(POINTS, a.histCount - 2 * lag))
    this.lag = lag
    this.count = n
    if (n < 2) return
    const gain = (size * 0.45) / Math.max(a.ampPeak, AMP_FLOOR)
    this.gain = gain
    embedRing(a.hist, a.newest, n, lag, gain, this.points)

    if (n !== this.lutCount) {
      // the same fade as the trajectories' tails (tailBrightness with fade on): u^1.5 by age
      const last = n - 1
      for (let age = 0; age < n; age++) this.lut[age] = Math.pow(1 - age / last, 1.5)
      this.lutCount = n
    }
    // rotation keeps lengths, so |p| / gain is the radius in sample units
    const r0 = a.centreRadius * gain
    const lo = r0 * r0
    const hi = 4 * lo
    const p = this.points
    const b = this.brightness
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      const rr = p[o] * p[o] + p[o + 1] * p[o + 1] + p[o + 2] * p[o + 2]
      const g = rr >= hi ? 1 : rr <= lo ? 0 : smoothstep(lo, hi, rr)
      b[i] = this.lut[n - 1 - i] * g
    }
    const ref = BEAM_REF * size
    const ref2 = ref * ref
    const seg = this.segment
    for (let j = 0, o = 0; j < n - 1; j++, o += 3) {
      const dx = p[o + 3] - p[o]
      const dy = p[o + 4] - p[o + 1]
      const dz = p[o + 5] - p[o + 2]
      const ll = dx * dx + dy * dy + dz * dz
      seg[j] = ll <= ref2 ? 1 : ref / Math.sqrt(ll)
    }
  }
}
