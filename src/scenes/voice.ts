/**
 * Your voice is an attractor. The narrator's voice, live, drawn in dust: first as a wave, a
 * scribble of amplitude against time; then plotted against itself a moment ago and a moment
 * before that (Takens's delay embedding), where it opens out into a shape. Vowels draw loops,
 * consonants and breath draw tangles. At the end the visitor can lend it their own voice.
 */
import { plate as namePlate, readout } from './kit/hud'
import { dataTexture, SpreadSource } from './kit/SpreadSource'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { AMP_FLOOR, POINTS, QUIET_LEVEL, VoiceAnalysis, VoiceCurve } from '../world/voice/analysis'
import { TONE, WINDOW, dbToGain } from '../world/voice/dsp'
import { FLOOR } from './kit/shared'
import type { DustLook } from '../engine/Dust'

/** world size of the shape: the loudest recent sample reaches 0.45 × SIZE on each axis */
const SIZE = 2.5
/** the flat wave: width, and height of the loudest recent sample */
const FLAT_W = 3.4
const FLAT_H = 0.5
/** where the picture is centred */
const CY = 0.12
/** the sample ring VoiceAnalysis keeps (HISTORY) */
const RING = 8192
/** level (relative to the recent loudest) below which a stretch counts as a gap between words */
const LOUD = Math.max(0.2, QUIET_LEVEL * 6)
/** RMS distance of the shape's points from its centre, world units */
const SPREAD = 0.3

type Source = 'narration' | 'mic' | 'tone'

/** the samples' texture is SAMPLE_W wide: rows 0..SAMPLE_ROWS−1 hold (embedded xyz, flat
 *  height), the rows after them the brightness */
const SAMPLE_W = 128
const SAMPLE_ROWS = Math.ceil(POINTS / SAMPLE_W)

/**
 * Every particle rides one sample of the stretch just heard, a fraction of the way to the next.
 * The CPU keeps the few thousand samples; this places the quarter of a million particles on
 * them, so a frame uploads the samples instead of every particle's position.
 */
const frag = /* glsl */ `
uniform sampler2D uSamples;
/** per particle: where along its segment it sits, and its jitter */
uniform sampler2D uSeed;
uniform int uN;
/** the newest sample's absolute index, modulo uN */
uniform int uNewest;
uniform float uFold;
uniform float uGlow;
uniform float uFlatW;
uniform float uRest;

vec4 sampleAt(int k) {
  return texelFetch(uSamples, ivec2(k % ${SAMPLE_W}, k / ${SAMPLE_W}), 0);
}
float brightAt(int k) {
  return texelFetch(uSamples, ivec2(k % ${SAMPLE_W}, ${SAMPLE_ROWS} + k / ${SAMPLE_W}), 0).x;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 seed = texelFetch(uSeed, c, 0);
  float f = seed.x;
  vec3 jit = seed.yzw;
  if (uRest > 0.0) {
    // before anything is heard: a scope's resting line
    gl_FragColor = vec4((f - 0.5) * uFlatW, jit.y * 0.5, jit.z, 0.22 * (1.0 - abs(f - 0.5) * 1.6));
    return;
  }
  // the sample this particle rides: the newest one whose index matches its own, modulo n
  int p = c.y * int(uSize) + c.x;
  int age = (uNewest - p % uN + uN) % uN;
  int k = uN - 1 - age;
  if (k == 0) k = 1;
  int k0 = k - 1;
  float w = uFlatW / float(uN - 1);
  float fx0 = (float(k0) - float(uN - 1) / 2.0) * w;
  float fx1 = fx0 + w;
  vec4 a = sampleAt(k0);
  vec4 b = sampleAt(k);
  float x = fx0 + (fx1 - fx0) * f;
  float y = a.w + (b.w - a.w) * f;
  vec3 e = a.xyz + (b.xyz - a.xyz) * f;
  float u = uFold;
  float bk0 = brightAt(k0);
  float bright = bk0 + (brightAt(k) - bk0) * f;
  gl_FragColor = vec4(x + (e.x - x) * u + jit.x, y + (e.y - y) * u + jit.y, e.z * u + jit.z, bright * uGlow);
}
`

/** the synthesized vowel (dsp.ts TONE) as a Web Audio graph, into `out` and the analyser */
class Tone {
  readonly out: GainNode
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private stopped = false

  constructor(private readonly ac: AudioContext) {
    const t0 = ac.currentTime + 0.02
    const out = ac.createGain()
    out.gain.value = 0
    out.gain.setTargetAtTime(dbToGain(TONE.levelDb), t0, 0.05)
    this.out = out
    const lfo = ac.createOscillator()
    lfo.frequency.value = TONE.vibratoHz
    const depth = ac.createGain()
    depth.gain.value = 1200 * Math.log2(1 + TONE.vibratoDepth)
    lfo.connect(depth)
    this.sources.push(lfo)
    this.nodes.push(depth)
    let sum = 0
    for (const a of TONE.harmonics) sum += a
    TONE.harmonics.forEach((a, i) => {
      const osc = ac.createOscillator()
      osc.frequency.value = TONE.f0 * (i + 1)
      depth.connect(osc.detune)
      const g = ac.createGain()
      g.gain.value = a / sum
      osc.connect(g)
      g.connect(out)
      this.sources.push(osc)
      this.nodes.push(g)
    })
    const len = Math.round(ac.sampleRate * 2)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = 2 * Math.random() - 1
    const noise = ac.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = TONE.breathHz
    bp.Q.value = TONE.breathQ
    const ng = ac.createGain()
    ng.gain.value = TONE.breath
    noise.connect(bp)
    bp.connect(ng)
    ng.connect(out)
    this.sources.push(noise)
    this.nodes.push(bp, ng)
    for (const s of this.sources) s.start(t0)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    const t = this.ac.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setTargetAtTime(0, t, 0.04)
    for (const s of this.sources) s.stop(t + 0.3)
    this.sources[0].onended = () => {
      for (const s of this.sources) s.disconnect()
      for (const n of this.nodes) n.disconnect()
      this.out.disconnect()
    }
  }
}

/** What the analyser hears: the narrator's bus, the visitor's microphone, or the vowel. */
class Ear {
  readonly analyser: AnalyserNode
  /** bumps whenever a different node starts feeding the analyser */
  serial = 0
  /** why the microphone cannot be used, for the lab; null when fine */
  micError: string | null = null
  private kind: Source | null = null
  private feed: AudioNode | null = null
  private tone: Tone | null = null
  private mic: MediaStream | null = null
  private micNode: MediaStreamAudioSourceNode | null = null
  private asking = false

  get micLive() {
    return this.micNode !== null
  }

  constructor(readonly ac: AudioContext) {
    const a = ac.createAnalyser()
    a.fftSize = WINDOW
    a.smoothingTimeConstant = 0
    this.analyser = a
  }

  /** make `source` the input (cheap when nothing changed); true when something is connected */
  sync(source: Source): boolean {
    if (source !== this.kind) {
      this.detach()
      this.kind = source
    }
    if (this.feed) return true
    if (source === 'narration') {
      const tap = sound.voiceTap
      if (tap) {
        tap.connect(this.analyser)
        this.feed = tap
      }
    } else if (source === 'tone') {
      const t = new Tone(this.ac)
      t.out.connect(this.analyser)
      if (sound.output) t.out.connect(sound.output)
      this.tone = t
      this.feed = t.out
    } else if (this.mic) {
      const node = this.ac.createMediaStreamSource(this.mic)
      node.connect(this.analyser)
      this.micNode = node
      this.feed = node
    } else if (!this.asking) {
      this.askMic()
    }
    if (this.feed) this.serial++
    return this.feed !== null
  }

  private askMic() {
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      this.micError = window.isSecureContext ? 'This browser does not give pages a microphone.' : 'The microphone needs a secure (https) page.'
      return
    }
    this.asking = true
    this.micError = null
    media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }, video: false }).then(
      (stream) => {
        this.asking = false
        if (this.kind !== 'mic') {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        this.mic = stream
      },
      (e: unknown) => {
        this.asking = false
        const name = e instanceof DOMException ? e.name : ''
        this.micError = name === 'NotAllowedError' ? 'Microphone access was blocked.' : name === 'NotFoundError' ? 'No microphone was found.' : 'The microphone could not be used.'
      },
    )
  }

  private detach() {
    if (this.feed) {
      try {
        this.feed.disconnect(this.analyser)
      } catch {
        /* already gone */
      }
    }
    this.feed = null
    this.tone?.stop()
    this.tone = null
    this.micNode?.disconnect()
    this.micNode = null
    if (this.mic) for (const t of this.mic.getTracks()) t.stop()
    this.mic = null
  }

  dispose() {
    this.detach()
    this.kind = null
    this.analyser.disconnect()
  }
}

const voice: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, size, renderer } = ctx
  const count = size * size

  let source: Source = 'narration'
  let delayMs = 1.6
  let ear: Ear | null = null
  let analysis: VoiceAnalysis | null = null
  const curve = new VoiceCurve()
  /** the flat wave spans the frame: narrower on a tall screen */
  const flatW = () => (ctx.portrait ? FLAT_W * 0.5 : FLAT_W)

  // per particle: where along its segment it sits, and a hair of jitter
  const seedData = new Float32Array(count * 4)
  {
    let s = 0x9e3779b9
    const r = () => {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      return (s >>> 0) / 4294967296
    }
    for (let i = 0; i < count; i++) {
      seedData[i * 4] = r()
      seedData[i * 4 + 1] = (r() - 0.5) * 0.006
      seedData[i * 4 + 2] = (r() - 0.5) * 0.006
      seedData[i * 4 + 3] = (r() - 0.5) * 0.006
    }
  }
  const seedTex = dataTexture(size, size, seedData)
  const sampleData = new Float32Array(SAMPLE_W * SAMPLE_ROWS * 2 * 4)
  const sampleTex = dataTexture(SAMPLE_W, SAMPLE_ROWS * 2, sampleData)
  const src = new SpreadSource(renderer, size, frag, {
    uSamples: { value: sampleTex },
    uSeed: { value: seedTex },
    uN: { value: 2 },
    uNewest: { value: 0 },
    uFold: { value: 0 },
    uGlow: { value: 0 },
    uFlatW: { value: FLAT_W },
    uRest: { value: 1 },
  })
  src.matrix.makeTranslation(0, CY, 0)

  // the last heard stretch: flat height, embedded point and brightness per sample, oldest first
  const flatY = new Float32Array(POINTS)
  const emb = new Float32Array(POINTS * 3)
  const bright = new Float32Array(POINTS)
  let n = 0
  // the last stretch that was a clear vowel: what is left on screen once the narrator stops
  const vFlat = new Float32Array(POINTS)
  const vEmb = new Float32Array(POINTS * 3)
  const vBright = new Float32Array(POINTS)
  let vn = 0
  let vNewest = 0
  /** the picture is the kept vowel, not the live input */
  let kept = false
  let keptScore = 0
  let keptAge = 0
  /** smoothed scale from the analysis' units to the room */
  let zoom = 0
  let dtNow = 0
  /** absolute index of the newest sample, so a particle keeps riding the same sample */
  let newest = 0
  let lastHead = -1
  let fold = 0
  /** brightness while the voice is held after it stops */
  let hold = 0
  let quiet = 99
  let fade = 0
  let keyOff: (() => void) | null = null
  let delayLabel: ReturnType<typeof ctx.label> | null = null
  let name: ReturnType<typeof ctx.label> | null = null
  let prompt: ReturnType<typeof ctx.label> | null = null

  const look = (): DustLook => ({
    ...dust.look,
    palette,
    size: 0.0024,
    minPx: 0.55,
    gain: 0.16,
    opacity: 1,
    streak: 0,
    tone: 'aux',
    speedNorm: 1,
    toneBias: 0.04,
    toneScale: 0.94,
    paint: null,
    paintMix: 0,
    twinkle: 0.12,
  })

  /** before anything is heard: a scope's resting line */
  const rest = () => {
    src.uniforms.uRest.value = 1
    src.uniforms.uFlatW.value = flatW()
    src.render(engine.time)
  }

  /** the stretch just heard, from the analysis into our own arrays */
  const capture = (a: VoiceAnalysis) => {
    curve.update(a, delayMs, SIZE)
    const m = curve.count
    if (m < 2) return false
    // how many samples arrived since last time: the absolute clock the particles ride on
    if (lastHead >= 0) newest += (a.histHead - lastHead + RING) & (RING - 1)
    lastHead = a.histHead
    n = m
    const gain = FLAT_H / Math.max(a.ampPeak, AMP_FLOOR)
    const h = a.hist
    const start = (a.newest - (m - 1) + RING) & (RING - 1)
    for (let i = 0; i < m; i++) flatY[i] = h[(start + i) & (RING - 1)] * gain
    // size by the shape's own spread, not its loudest peak, so a tone and a voice fill the same room
    const pts = curve.points
    let rr = 0
    for (let i = 0; i < m * 3; i++) rr += pts[i] * pts[i]
    const want = Math.min(2.5, Math.max(0.4, SPREAD / Math.sqrt(rr / m + 1e-9)))
    zoom = zoom === 0 ? want : zoom + (want - zoom) * Math.min(1, dtNow / 0.6)
    for (let i = 0; i < m * 3; i++) emb[i] = pts[i] * zoom
    const b = curve.brightness
    const seg = curve.segment
    for (let i = 0; i < m; i++) bright[i] = b[i] * (i < m - 1 ? seg[i] : 1)
    samplesDirty = true
    // keep the clearest recent vowel
    const score = a.pitch > 0 ? a.clarity * (1 - a.roughness) : 0
    keptAge += 1
    if (score > 0.6 && (score >= keptScore * 0.97 || keptAge > 150)) {
      vEmb.set(emb.subarray(0, m * 3))
      vFlat.set(flatY.subarray(0, m))
      vBright.set(bright.subarray(0, m))
      vn = m
      vNewest = newest
      keptScore = score
      keptAge = 0
    }
    return true
  }

  /** what changed since the last draw: the samples, or only the fold and the glow */
  let samplesDirty = true
  const draw = () => {
    if (n < 2) return
    if (samplesDirty) {
      const d = sampleData
      const bo = SAMPLE_W * SAMPLE_ROWS * 4
      for (let k = 0; k < n; k++) {
        const o = k * 4
        d[o] = emb[k * 3]
        d[o + 1] = emb[k * 3 + 1]
        d[o + 2] = emb[k * 3 + 2]
        d[o + 3] = flatY[k]
        d[bo + o] = bright[k]
      }
      sampleTex.needsUpdate = true
      samplesDirty = false
    }
    const u = src.uniforms
    u.uRest.value = 0
    u.uN.value = n
    u.uNewest.value = newest % n
    u.uFold.value = fold
    u.uGlow.value = hold
    u.uFlatW.value = flatW()
    src.render(engine.time)
  }

  const setSource = (s: Source) => {
    source = s
    kept = false
    if (s !== 'narration') sound.unlock()
    lastHead = -1
  }

  const useMic = () => {
    setSource('mic')
    prompt?.set('listening. Nothing is recorded or sent anywhere.')
  }

  rest()

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      void dust.morphTo(src, look(), { seconds: 3, swirl: 0.8 })
      ctx.tween(2, (u) => (fade = u))
      rig.shot({ target: [0, CY, 0], distance: 3.3, azimuth: 0, elevation: 3, fov: 38, orbit: 0, aperture: 0.003, portrait: { distance: 2.2 } }, 3)
      const onKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== 'v' || e.repeat || e.metaKey || e.ctrlKey) return
        if (source === 'mic') {
          setSource('narration')
          return
        }
        useMic()
        // hold the film here while the visitor plays: the chrome opens the lab on L
        if (!ctx.lab) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
      }
      window.addEventListener('keydown', onKey)
      keyOff = () => window.removeEventListener('keydown', onKey)
    },

    cues: [
      // "plot that wave against itself, a moment ago. And a moment before that."
      at(2, 'against itself', () => {
        ctx.tween(Math.max(3.5, ctx.until(3) + 0.6), (u) => (fold = u), { ease: easeInOut, tag: 'fold' })
        rig.shot({ distance: 3.0, elevation: 8, azimuth: 12, portrait: { distance: 2.0 } }, 5)
      }),
      at(2, 'a moment ago', () => {
        delayLabel = readout(ctx, `delay  ${delayMs.toFixed(1)} ms`)
      }),
      // "A steady vowel is a loop. A rough breath is a tangle."
      at(4, () => rig.shot({ distance: 2.75, elevation: 14, azimuth: 26, orbit: 3, aperture: 0.005, portrait: { distance: 1.9 } }, 5)),
      at(5, () => {
        delayLabel?.remove()
        name = namePlate(ctx, 'Delay embedding', 'Floris Takens, 1981')
      }),
      at(6, () => name?.remove()),
      at(7, () => rig.shot({ distance: 3.1, elevation: 9, orbit: 2, portrait: { distance: 2.1 } }, 5)),
      // the narrator has stopped: leave his last clear vowel on screen, flown into place
      at('end', () => {
        if (vn < 2 || source !== 'narration') return
        dust.setSource(dust.bake(), { ...dust.look })
        flatY.set(vFlat.subarray(0, vn))
        emb.set(vEmb.subarray(0, vn * 3))
        bright.set(vBright.subarray(0, vn))
        n = vn
        newest = vNewest
        samplesDirty = true
        kept = true
        hold = 0.9
        draw()
        void dust.morphTo(src, look(), { seconds: 1.6, swirl: 0.25 })
      }),
      at('end', 0.3, () => {
        prompt = ctx.label('press V, or open the lab, to use your microphone', { kind: 'note', at: [0, CY - 0.84, 0], align: 'below', dy: 8 })
      }),
    ],

    explore() {
      // no narrator to listen to here: open the space the shape lives in and ask for a voice
      ctx.tween(2.4, (u) => (fold = u), { ease: easeInOut, tag: 'fold' })
      ctx.after(2.6, () => {
        ctx.label('choose “My microphone” in the drawer, and speak', { kind: 'note', at: { screen: [0.5, 0.72] }, align: 'center' })
      })
    },

    update(dt) {
      dtNow = dt
      const ac = sound.context
      if (ac && !ear) ear = new Ear(ac)
      if (ac && ear && (!analysis || analysis.sampleRate !== ac.sampleRate)) analysis = new VoiceAnalysis(ac.sampleRate)
      let heard = false
      // paused: everything holds still
      if (ear && analysis && dt > 0 && ac) {
        const a = analysis
        const connected = ear.sync(source)
        a.adaptiveFloor = source === 'mic'
        if (connected && ac.state === 'running') {
          ear.analyser.getFloatTimeDomainData(a.win)
          a.ingest(ear.serial, ac.currentTime)
        } else {
          a.idle()
        }
        a.follow(dt)
        // only a stretch with a voice in it replaces the picture; between words the last one holds
        quiet = a.level < LOUD ? quiet + dt : 0
        if (quiet === 0 && !kept) heard = capture(a)
      }
      // a heard shape stays up between words, fading a little while the voice is silent
      if (dt > 0) {
        const want = kept ? 0.9 : quiet < 0.3 ? 1 : 0.55
        hold += (want - hold) * (1 - Math.exp(-dt / (want > hold ? 0.08 : 1.2)))
      }
      if (n >= 2 && (heard || dt > 0)) draw()
      dust.look.opacity = fade
    },

    exit() {
      prompt?.remove()
      keyOff?.()
      keyOff = null
    },

    dispose() {
      keyOff?.()
      ear?.dispose()
      src.dispose()
      seedTex.dispose()
      sampleTex.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Listening to',
        options: [
          { value: 'narration', label: 'The narrator' },
          { value: 'mic', label: 'My microphone' },
          { value: 'tone', label: 'A steady tone' },
        ],
        get: () => source,
        set: (v) => {
          if (v === 'mic') useMic()
          else setSource(v as Source)
          if (fold < 1) {
            ctx.cancel('fold')
            ctx.tween(2, (u) => (fold = fold + (1 - fold) * u), { ease: easeInOut, tag: 'fold' })
          }
        },
      },
      {
        kind: 'slider',
        label: 'Delay',
        min: 0.2,
        max: 8,
        step: 0.1,
        get: () => delayMs,
        set: (v) => {
          delayMs = v
          delayLabel?.set(`delay  ${v.toFixed(1)} ms`)
        },
        format: (v) => `${v.toFixed(1)} ms`,
      },
      { kind: 'readout', label: 'Level', get: () => (analysis ? `${Math.round(analysis.level * 100)} %` : '—') },
      { kind: 'readout', label: 'Pitch', get: () => (analysis && analysis.pitch > 0 ? `${Math.round(analysis.pitch)} Hz` : '—') },
      { kind: 'readout', label: 'Microphone', get: () => ear?.micError ?? (source !== 'mic' ? 'off' : ear?.micLive ? 'on' : 'waiting for permission') },
    ],
    notes: [
      'Each point of the shape is one moment of the sound, x(t), placed at the coordinates (x(t), x(t − τ), x(t − 2τ)): the wave plotted against itself a moment ago and a moment before that. τ is a millisecond or two. A steady vowel repeats itself every cycle, so it closes into a loop; a hiss never repeats, so it fills a tangle.',
      'Floris Takens proved in 1981 that this works for any deterministic system: from a single measured signal, delayed against itself, you can rebuild a faithful copy of the shape of the whole system that produced it, without knowing its equations. Cardiologists use the idea on heartbeats, engineers on the vibration of turbines and bearings.',
      'With the microphone on, the shape is drawn from your own voice in your browser. Nothing is recorded, stored or sent anywhere; the sound is analysed a few milliseconds at a time and forgotten.',
    ],
  }
}

export default voice
