import { audio } from '../../audio/engine'
import type { VoiceState } from '../../fractal/types'
import { TONE, WINDOW, dbToGain } from './dsp'

export type VoiceSource = VoiceState['source']

/** Read by the UI (poll it, like catStatus). */
export const voiceStatus = {
  /** why the microphone could not be used, as a sentence for the visitor; null when fine */
  micError: null as string | null,
  /** the microphone is open (its track is live) */
  micActive: false,
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  video: false,
}
/** a granted stream that no VoiceAttractor starts listening to within this long is closed again */
const MIC_CLAIM_MS = 2000

let micStream: MediaStream | null = null
let micRequest: Promise<boolean> | null = null
/** bumps on every release, so a request that resolves after the visitor moved on is dropped */
let micEpoch = 0
let claimTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Open the microphone. Call it from a click or key handler: the permission prompt has to
 * belong to a user gesture (this also unlocks the app's audio, which the attractor listens
 * through). Resolves true once the microphone is open; the attractor starts drawing it when
 * `voice.source` is 'mic', whichever of the two happens first.
 *
 * Resolves false when it cannot be used, with `voiceStatus.micError` saying why; switching
 * `source` back is the caller's job. It also resolves false, with micError null, when
 * `source` left 'mic' while the prompt was open. Calls while one is pending share it.
 * The microphone closes again as soon as `source` leaves 'mic' or the attractor unmounts,
 * so every switch to 'mic' needs its own requestMic() call.
 */
export function requestMic(): Promise<boolean> {
  if (micStream) return Promise.resolve(true)
  if (micRequest) return micRequest
  audio.unlock()
  if (!audio.context) return Promise.resolve(micFailed('This browser cannot process sound, so it cannot listen either.'))
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!media || typeof media.getUserMedia !== 'function') {
    return Promise.resolve(
      micFailed(
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'The microphone only works on a secure (https) page.'
          : 'This browser does not give pages access to a microphone.',
      ),
    )
  }
  const epoch = micEpoch
  voiceStatus.micError = null
  const run = media.getUserMedia(MIC_CONSTRAINTS).then(
    (stream) => {
      if (epoch !== micEpoch) {
        // the visitor chose another source while the prompt was open
        stopTracks(stream)
        return false
      }
      const track = stream.getAudioTracks()[0]
      if (!track || track.readyState !== 'live') {
        stopTracks(stream)
        return micFailed('The microphone sent no sound.')
      }
      adoptMic(stream, track)
      return true
    },
    (e: unknown) => {
      console.warn('[VoiceAttractor] microphone unavailable:', e)
      return micFailed(describeMicError(e))
    },
  )
  micRequest = run.finally(() => {
    micRequest = null
  })
  return micRequest
}

function micFailed(message: string): false {
  voiceStatus.micError = message
  voiceStatus.micActive = false
  return false
}

function adoptMic(stream: MediaStream, track: MediaStreamTrack): void {
  micStream = stream
  voiceStatus.micActive = true
  voiceStatus.micError = null
  track.addEventListener('ended', () => {
    if (micStream !== stream) return
    releaseMic()
    voiceStatus.micError = 'The microphone stopped sending sound.'
  })
  if (claimTimer !== null) clearTimeout(claimTimer)
  claimTimer = setTimeout(() => {
    claimTimer = null
    if (micStream === stream) {
      releaseMic()
      voiceStatus.micError = 'The microphone was opened but nothing was listening. Try again.'
    }
  }, MIC_CLAIM_MS)
}

/** @internal the open microphone, marked as in use (cancels the unclaimed-stream timeout) */
export function claimMicStream(): MediaStream | null {
  if (!micStream) return null
  if (claimTimer !== null) {
    clearTimeout(claimTimer)
    claimTimer = null
  }
  return micStream
}

/** @internal close the microphone (idempotent); a request still pending is dropped when it resolves */
export function releaseMic(): void {
  micEpoch++
  if (claimTimer !== null) {
    clearTimeout(claimTimer)
    claimTimer = null
  }
  if (micStream) stopTracks(micStream)
  micStream = null
  voiceStatus.micActive = false
}

function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop()
}

function describeMicError(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow it for this page to draw your own voice.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone could not be started. Another app may be using it.'
    default:
      return 'The microphone could not be used.'
  }
}

// ---------------------------------------------------------------- the synthesized vowel

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    // 2 s of white noise, looped; long enough that the loop point is inaudible under the vowel
    buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = 2 * Math.random() - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

/**
 * TONE (dsp.ts) as a Web Audio graph: six sine oscillators at k·118 Hz sharing one vibrato
 * LFO on their `detune` (so they stay phase-locked), plus band-passed noise, into `out`.
 * Fades in over ~0.1 s; stop() fades out and frees the nodes.
 */
class Tone {
  readonly out: GainNode
  private readonly ctx: AudioContext
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly nodes: AudioNode[] = []
  private level = 1
  private stopped = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    const t0 = ctx.currentTime + 0.02
    const out = ctx.createGain()
    out.gain.value = 0
    out.gain.setTargetAtTime(dbToGain(TONE.levelDb), t0, 0.03)
    this.out = out

    const lfo = ctx.createOscillator()
    lfo.frequency.value = TONE.vibratoHz
    const depth = ctx.createGain()
    depth.gain.value = 1200 * Math.log2(1 + TONE.vibratoDepth) // cents
    lfo.connect(depth)
    this.sources.push(lfo)
    this.nodes.push(depth)

    let sum = 0
    for (const a of TONE.harmonics) sum += a
    TONE.harmonics.forEach((a, i) => {
      const osc = ctx.createOscillator()
      osc.frequency.value = TONE.f0 * (i + 1)
      depth.connect(osc.detune)
      const g = ctx.createGain()
      g.gain.value = a / sum
      osc.connect(g)
      g.connect(out)
      this.sources.push(osc)
      this.nodes.push(g)
    })

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx)
    noise.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = TONE.breathHz
    bp.Q.value = TONE.breathQ
    const ng = ctx.createGain()
    ng.gain.value = TONE.breath
    noise.connect(bp)
    bp.connect(ng)
    ng.connect(out)
    this.sources.push(noise)
    this.nodes.push(bp, ng)

    // one start time for all of them: the harmonics begin in phase and stay that way
    for (const s of this.sources) s.start(t0)
  }

  /** 0..1 multiplier on the tone's level (the stage's fade), ramped */
  setLevel(level: number): void {
    if (this.stopped || Math.abs(level - this.level) < 0.01) return
    this.level = level
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setTargetAtTime(dbToGain(TONE.levelDb) * level, t, 0.05)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setTargetAtTime(0, t, 0.04)
    const end = t + 0.3
    for (const s of this.sources) s.stop(end)
    this.sources[0].onended = () => {
      for (const s of this.sources) s.disconnect()
      for (const n of this.nodes) n.disconnect()
      this.out.disconnect()
    }
  }
}

// ---------------------------------------------------------------- the analyser and what feeds it

/**
 * The AnalyserNode the attractor reads, and whichever node currently feeds it:
 *  - narration: the engine's voice bus (tap → analyser only; the analyser connects to nothing)
 *  - mic: a MediaStreamAudioSourceNode on the open microphone, never routed to the speakers
 *  - tone: the synthesized vowel, into the analyser and the master gain (so mute applies)
 */
export class VoiceInput {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  /** bumps whenever a different node starts feeding the analyser */
  serial = 0

  private kind: VoiceSource | null = null
  private feed: AudioNode | null = null
  private tone: Tone | null = null
  private micNode: MediaStreamAudioSourceNode | null = null
  private micFeed: MediaStream | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    const a = ctx.createAnalyser()
    a.fftSize = WINDOW
    a.smoothingTimeConstant = 0
    this.analyser = a
  }

  /**
   * Make `source` the analyser's input, building it if needed. Cheap when nothing changed, so
   * call it every frame; returns whether something is connected (the narration tap before
   * unlock, or the microphone before requestMic() succeeds, are not).
   */
  sync(source: VoiceSource): boolean {
    if (source !== this.kind) {
      this.detach()
      this.kind = source
    }
    // the microphone closed under us (track ended, or released): drop the dead node, keep waiting
    if (this.micNode && claimMicStream() !== this.micFeed) this.dropMicNode()
    if (this.feed) return true

    if (source === 'narration') {
      const tap = audio.voiceTap
      if (tap) {
        tap.connect(this.analyser)
        this.feed = tap
      }
    } else if (source === 'mic') {
      const stream = claimMicStream()
      if (stream) {
        const node = this.ctx.createMediaStreamSource(stream)
        node.connect(this.analyser)
        this.micNode = node
        this.micFeed = stream
        this.feed = node
      }
    } else {
      const tone = new Tone(this.ctx)
      tone.out.connect(this.analyser)
      const master = audio.masterNode
      if (master) tone.out.connect(master)
      this.tone = tone
      this.feed = tone.out
    }
    if (this.feed) this.serial++
    return this.feed !== null
  }

  /** the stage's 0..1 fade, applied to the tone so it fades with the picture */
  setToneLevel(level: number): void {
    this.tone?.setLevel(level)
  }

  dispose(): void {
    this.detach()
    this.kind = null
    this.analyser.disconnect()
  }

  private detach(): void {
    if (this.feed && this.feed !== this.micNode) {
      try {
        this.feed.disconnect(this.analyser)
      } catch {
        /* already disconnected */
      }
    }
    this.feed = null
    this.dropMicNode()
    if (this.tone) {
      this.tone.stop()
      this.tone = null
    }
    if (this.kind === 'mic') releaseMic()
  }

  private dropMicNode(): void {
    if (!this.micNode) return
    this.micNode.disconnect()
    if (this.feed === this.micNode) this.feed = null
    this.micNode = null
    this.micFeed = null
  }
}
