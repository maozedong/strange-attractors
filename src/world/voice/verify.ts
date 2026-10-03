/**
 * Checks the voice stage's signal maths:  pnpm tsx src/world/voice/verify.ts [--preview <dir>]
 *
 * 1. Pitch: the autocorrelation tracker on a 220 Hz sawtooth + noise reads 220 ± 3 Hz (at
 *    48 and 44.1 kHz, many phases and noise draws); a table of other pitches; noise reads 0.
 * 2. Rotation: EMBED_ROTATION maps (1,1,1)/√3 to (0,1,0) within 1e-9, is orthonormal, det +1.
 * 3. Embedding of a pure sine: the delay pair (x(t), x(t − T/4)) is a circle; in 3-D the
 *    circle needs τ = T/3 (with τ = T/4 the curve is an ellipse of axes √2 : 1, as predicted);
 *    the loop at the default τ tilts back from vertical by the angle the maths predicts.
 * 4. Stitching: overlapping analyser reads (random advances, jittered clock) rebuild the
 *    continuous signal bit-exactly; a gap longer than the window restarts it.
 * 5. Roughness, level, the listening gate (digital silence and a noisy microphone), and the
 *    per-frame cost of analysis + curve.
 * 6. How big the curve gets at size 2.4, and the camera distance that frames it at fov 40.
 *
 * With --preview <dir>, also renders the curve for a few signals to PNG (additive lines,
 * a simple tone curve, no bloom) from the chapter's camera pose. Nothing here is bundled.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  EMBED_ROTATION,
  PitchEstimator,
  RoughnessMeter,
  WINDOW,
  embedRing,
  mean,
  smoothstep,
  speedColorInto,
  synthesizeTone,
} from './dsp'
import { HISTORY, POINTS, QUIET_LEVEL, VoiceAnalysis, VoiceCurve } from './analysis'
import { CURVE_GAIN, HEAD_GAIN, HEAD_WHITEN, LINE_PX, TINT_CLEAN, TINT_ROUGH } from './look'

let failures = 0
function check(ok: boolean, what: string): void {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
}
const f3 = (x: number, d = 3) => x.toFixed(d)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** naive sawtooth in [−amp, amp] plus uniform noise in [−noise, noise] */
function sawtooth(sr: number, f: number, n: number, phase: number, amp: number, noise: number, rand: () => number) {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = (phase + (f * i) / sr) % 1
    x[i] = amp * (2 * p - 1) + noise * (2 * rand() - 1)
  }
  return x
}

function white(n: number, rms: number, rand: () => number): Float32Array {
  const x = new Float32Array(n)
  const k = rms * Math.sqrt(3)
  for (let i = 0; i < n; i++) x[i] = k * (2 * rand() - 1)
  return x
}

function tone(sr: number, n: number, seed: number): Float32Array {
  const x = new Float32Array(n)
  synthesizeTone(sr, x, mulberry32(seed))
  return x
}

// ---------------------------------------------------------------- 1. pitch

console.log('\n1. pitch (normalised autocorrelation, 60 to 500 Hz)')
for (const sr of [48000, 44100]) {
  const est = new PitchEstimator(sr)
  const rand = mulberry32(7)
  let lo = Infinity
  let hi = -Infinity
  for (let trial = 0; trial < 40; trial++) {
    // amplitude 0.3 (RMS 0.17) against noise of RMS 0.035: about 14 dB SNR
    const x = sawtooth(sr, 220, WINDOW, rand(), 0.3, 0.06, rand)
    const p = est.estimate(x)
    lo = Math.min(lo, p)
    hi = Math.max(hi, p)
  }
  check(lo >= 217 && hi <= 223, `220 Hz sawtooth + noise at ${sr} Hz, 40 draws: ${f3(lo, 2)} .. ${f3(hi, 2)} Hz (want 220 ± 3)`)
}
{
  const sr = 48000
  const est = new PitchEstimator(sr)
  const rand = mulberry32(11)
  const rows: string[] = []
  let worst = 0
  for (const f of [62, 80, 100, 118, 150, 196, 262, 330, 440, 490]) {
    const p = est.estimate(sawtooth(sr, f, WINDOW, 0.37, 0.3, 0.06, rand))
    worst = Math.max(worst, Math.abs(p / f - 1))
    rows.push(`${f}→${f3(p, 1)}`)
  }
  check(worst < 0.01, `sawtooth + noise across the range, worst error ${f3(worst * 100, 2)} %: ${rows.join('  ')}`)
  const t = tone(sr, 3 * sr, 3)
  let tlo = Infinity
  let thi = -Infinity
  for (let k = 0; k < 40; k++) {
    const start = sr + Math.floor((k * sr) / 40)
    const p = est.estimate(t.subarray(start, start + WINDOW))
    tlo = Math.min(tlo, p)
    thi = Math.max(thi, p)
  }
  check(tlo > 118 * 0.96 && thi < 118 * 1.04, `the synthesized vowel (118 Hz ± 3 % vibrato): ${f3(tlo, 1)} .. ${f3(thi, 1)} Hz`)
  const pn = est.estimate(white(WINDOW, 0.05, mulberry32(5)))
  check(pn === 0, `white noise reads 0 Hz (clarity ${f3(est.clarity, 2)} < 0.5)`)
}

// ---------------------------------------------------------------- 2. rotation

console.log('\n2. rotation of the embedding')
{
  const R = EMBED_ROTATION
  const d = 1 / Math.sqrt(3)
  const y = [R[0] * d + R[1] * d + R[2] * d, R[3] * d + R[4] * d + R[5] * d, R[6] * d + R[7] * d + R[8] * d]
  const err = Math.hypot(y[0], y[1] - 1, y[2])
  check(err < 1e-9, `(1,1,1)/√3 → (${y.map((v) => v.toExponential(2)).join(', ')}), |error| = ${err.toExponential(2)}`)
  let orth = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2]
      orth = Math.max(orth, Math.abs(dot - (i === j ? 1 : 0)))
    }
  }
  const det =
    R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6])
  check(orth < 1e-12 && Math.abs(det - 1) < 1e-12, `orthonormal (max |RRᵀ − I| = ${orth.toExponential(1)}), det = ${f3(det, 12)}`)
}

// ---------------------------------------------------------------- 3. embedding of a sine

console.log('\n3. delay embedding of a pure sine (100 Hz at 48 kHz: T = 480 samples)')
{
  const sr = 48000
  const T = 480
  const A = 0.5
  const ring = new Float32Array(HISTORY)
  for (let i = 0; i < HISTORY; i++) ring[i] = A * Math.sin((2 * Math.PI * i) / T)
  const newest = HISTORY - 1
  const count = WINDOW
  const radii = (lag: number) => {
    const out = new Float64Array(count * 3)
    embedRing(ring, newest, count, lag, 1, out)
    let lo = Infinity
    let hi = 0
    let sum = 0
    let maxY = 0
    for (let i = 0; i < count; i++) {
      const r = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2])
      lo = Math.min(lo, r)
      hi = Math.max(hi, r)
      sum += r
      maxY = Math.max(maxY, Math.abs(out[i * 3 + 1]))
    }
    return { lo, hi, mean: sum / count, maxY, out }
  }
  // the delay pair the textbooks draw: (x(t), x(t − T/4)) = A(sin, −cos)
  {
    const lag = T / 4
    let lo = Infinity
    let hi = 0
    for (let i = 2 * lag; i < HISTORY; i++) {
      const r = Math.hypot(ring[i], ring[i - lag])
      lo = Math.min(lo, r)
      hi = Math.max(hi, r)
    }
    check((hi - lo) / hi < 0.01, `2-D pair (x(t), x(t − T/4)) is a circle: radius ${f3(lo, 5)} .. ${f3(hi, 5)} (variation ${f3((100 * (hi - lo)) / hi, 4)} %)`)
  }
  {
    const r = radii(T / 4)
    const ratio = r.lo / r.hi
    check(
      Math.abs(ratio - Math.SQRT1_2) < 1e-3,
      `3-D, τ = T/4: an ellipse, not a circle: radius ${f3(r.lo, 4)} .. ${f3(r.hi, 4)}, ratio ${f3(ratio, 4)} (predicted 1/√2 = 0.7071; |p|² = A²(1 + sin²θ))`,
    )
  }
  {
    const r = radii(T / 3)
    const want = A * Math.sqrt(1.5)
    check(
      (r.hi - r.lo) / r.hi < 0.01 && Math.abs(r.mean - want) < 1e-3 * want,
      `3-D, τ = T/3: a circle: radius ${f3(r.lo, 5)} .. ${f3(r.hi, 5)} (variation ${f3((100 * (r.hi - r.lo)) / r.hi, 4)} %, predicted A·√1.5 = ${f3(want, 5)})`,
    )
    check(r.maxY < 1e-6, `   and it lies flat (max |world Y| = ${r.maxY.toExponential(1)}): three-phase, so x0 + x1 + x2 = 0`)
  }
  // the default delay on a 118 Hz sine: loop plane contains world X, tipped back from vertical
  {
    const f = 118
    const lag = Math.round(1.6e-3 * sr)
    const phi = (2 * Math.PI * f * lag) / sr
    const s = new Float32Array(HISTORY)
    for (let i = 0; i < HISTORY; i++) s[i] = Math.sin((2 * Math.PI * f * i) / sr)
    const out = new Float64Array(count * 3)
    embedRing(s, HISTORY - 1, count, lag, 1, out)
    // plane normal: mean of p_i × p_{i+q}, q a quarter period
    const q = Math.round(sr / f / 4)
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i + q < count; i++) {
      const a = i * 3
      const b = (i + q) * 3
      nx += out[a + 1] * out[b + 2] - out[a + 2] * out[b + 1]
      ny += out[a + 2] * out[b] - out[a] * out[b + 2]
      nz += out[a] * out[b + 1] - out[a + 1] * out[b]
    }
    const nl = Math.hypot(nx, ny, nz)
    const tilt = (Math.atan2(Math.abs(ny), Math.abs(nz)) * 180) / Math.PI
    const want = (Math.atan((Math.SQRT2 * (1 - Math.cos(phi))) / (1 + 2 * Math.cos(phi))) * 180) / Math.PI
    check(
      Math.abs(nx / nl) < 1e-3 && Math.abs(tilt - want) < 0.5,
      `118 Hz sine at τ = 1.6 ms (φ = ${f3((phi * 180) / Math.PI, 1)}°): loop faces +Z (normal x = ${f3(nx / nl, 4)}), tipped back ${f3(tilt, 1)}° (predicted ${f3(want, 1)}°)`,
    )
  }
}

// ---------------------------------------------------------------- 4. stitching

console.log('\n4. stitching overlapping analyser reads')
/** Feed `signal` to `a` as an AnalyserNode would: the latest WINDOW samples after each advance. */
function feed(
  a: VoiceAnalysis,
  signal: Float32Array,
  advances: (frame: number) => number,
  frames: number,
  opts: { jitter?: number; start?: number; serial?: number; dt?: number; onFrame?: (frame: number, pos: number) => void } = {},
): number {
  const rand = mulberry32(99)
  let pos = opts.start ?? WINDOW
  for (let k = 0; k < frames; k++) {
    pos = Math.min(signal.length, pos + advances(k))
    a.win.set(signal.subarray(pos - WINDOW, pos))
    const t = (pos + (opts.jitter ?? 0) * (2 * rand() - 1)) / a.sampleRate
    a.ingest(opts.serial ?? 1, t)
    a.follow(opts.dt ?? 1 / 60)
    opts.onFrame?.(k, pos)
  }
  return pos
}

/** the DC-blocked signal VoiceAnalysis should hold, recomputed independently from `start` */
function referenceHistory(a: VoiceAnalysis, signal: Float32Array, start: number, end: number): Float32Array {
  const R = 1 - (2 * Math.PI * 8) / a.sampleRate
  const out = new Float32Array(end - start)
  let x1 = signal[start]
  let y1 = 0
  for (let i = start; i < end; i++) {
    const y = signal[i] - x1 + R * y1
    x1 = signal[i]
    y1 = y
    out[i - start] = y
  }
  return out
}

function historyMatches(a: VoiceAnalysis, ref: Float32Array): { ok: boolean; compared: number } {
  const n = Math.min(a.histCount, ref.length)
  const mask = HISTORY - 1
  for (let k = 0; k < n; k++) {
    if (a.hist[(a.newest - k) & mask] !== ref[ref.length - 1 - k]) return { ok: false, compared: k }
  }
  return { ok: n > 0, compared: n }
}

{
  const sr = 48000
  const sig = tone(sr, 6 * sr, 21)
  const noise = white(sig.length, 0.004, mulberry32(4))
  for (let i = 0; i < sig.length; i++) sig[i] += noise[i]
  const a = new VoiceAnalysis(sr)
  const rand = mulberry32(5)
  // quantum-sized advances (0 = no new data that frame), plus odd sizes, with ±300 samples of clock jitter
  const steps = (k: number) => (k % 7 === 3 ? 0 : k % 5 === 0 ? 37 + Math.floor(rand() * 1500) : 128 * Math.floor(rand() * 16))
  const start = WINDOW
  const end = feed(a, sig, steps, 240, { jitter: 300, start })
  const ref = referenceHistory(a, sig, start - WINDOW, end)
  const m = historyMatches(a, ref)
  check(m.ok && m.compared === Math.min(HISTORY, ref.length), `240 jittered reads: the last ${m.compared} stored samples equal the signal exactly`)

  // a gap longer than the window: the stored signal restarts with the new read
  const gapEnd = end + WINDOW + 1904
  a.win.set(sig.subarray(gapEnd - WINDOW, gapEnd))
  a.ingest(1, gapEnd / sr)
  check(a.histCount === WINDOW, `a ${gapEnd - end}-sample gap restarts the history (${a.histCount} samples kept)`)
  const end2 = feed(a, sig, () => 800, 40, { start: gapEnd })
  const m2 = historyMatches(a, referenceHistory(a, sig, gapEnd - WINDOW, end2))
  check(m2.ok && m2.compared === Math.min(HISTORY, end2 - (gapEnd - WINDOW)), `and stays exact afterwards (${m2.compared} samples)`)
}

// ---------------------------------------------------------------- 5. roughness, level, gates, cost

console.log('\n5. roughness, level and the listening gate')
{
  const sr = 48000
  const meter = new RoughnessMeter(sr)
  const rough = (x: Float32Array) => Math.sqrt(meter.ratio(x, WINDOW, mean(x, WINDOW)))
  const rTone = rough(tone(sr, WINDOW * 4, 1).subarray(WINDOW * 3))
  const rSaw = rough(sawtooth(sr, 150, WINDOW, 0, 0.3, 0, mulberry32(1)))
  const rNoise = rough(white(WINDOW, 0.05, mulberry32(2)))
  check(rTone < 0.2 && rNoise > 0.85, `roughness (√ of the energy share above 2 kHz): vowel ${f3(rTone, 2)}, 150 Hz sawtooth ${f3(rSaw, 2)}, white noise ${f3(rNoise, 2)}`)
  const tint = (r: number) => {
    const c = speedColorInto(TINT_CLEAN + (TINT_ROUGH - TINT_CLEAN) * r, { r: 0, g: 0, b: 0 })
    return `(${f3(c.r, 2)}, ${f3(c.g, 2)}, ${f3(c.b, 2)})`
  }
  console.log(`      tints: vowel ${tint(rTone)}, sawtooth ${tint(rSaw)}, noise ${tint(rNoise)}`)
}
{
  // narration-like: 1.5 s of vowel, then digital silence
  const sr = 48000
  const sig = new Float32Array(4 * sr)
  sig.set(tone(sr, Math.round(1.5 * sr), 8), WINDOW)
  const a = new VoiceAnalysis(sr)
  const silenceAt = WINDOW + Math.round(1.5 * sr)
  let minLevel = 1
  let listenAfter = NaN
  feed(a, sig, () => 800, 220, {
    onFrame: (_k, pos) => {
      if (pos > WINDOW + 0.3 * sr && pos < silenceAt) minLevel = Math.min(minLevel, a.level)
      if (pos > silenceAt && Number.isNaN(listenAfter) && a.quietTime > 0.5) listenAfter = (pos - silenceAt) / sr
    },
  })
  check(minLevel > 0.9, `steady vowel: level stays ≥ ${f3(minLevel, 2)} (auto gain)`)
  check(listenAfter > 0.5 && listenAfter < 0.75, `digital silence: listening ring after ${f3(listenAfter, 2)} s (0.5 s hold + the window draining)`)
}
{
  // microphone in a room: hiss, then a quiet voice, then a long quiet vowel over the hiss
  const sr = 48000
  const len = 34 * sr
  const sig = white(len, 0.002, mulberry32(12))
  const voiceStart = 4 * sr
  const voice = sawtooth(sr, 150, 2 * sr, 0, 0.0173, 0, mulberry32(1)) // RMS 0.01, ~14 dB over the hiss
  for (let i = 0; i < voice.length; i++) sig[voiceStart + i] += voice[i]
  const humStart = 8 * sr
  const hum = tone(sr, 26 * sr, 9) // the vowel at −22 dB, RMS ≈ 0.023
  for (let i = 0; i < hum.length; i++) sig[humStart + i] += 0.3 * hum[i]
  const a = new VoiceAnalysis(sr)
  a.adaptiveFloor = true
  let hissLevel = 0
  let hissQuiet = 0
  let voiceLevel = 1
  let voicePitch: number[] = []
  let humLevel = 1
  feed(a, sig, () => 800, Math.floor((len - WINDOW) / 800) - 1, {
    onFrame: (_k, pos) => {
      if (pos > 2 * sr && pos < voiceStart) {
        hissLevel = Math.max(hissLevel, a.level)
        hissQuiet = a.quietTime
      }
      if (pos > voiceStart + 0.3 * sr && pos < voiceStart + 2 * sr) {
        voiceLevel = Math.min(voiceLevel, a.level)
        voicePitch.push(a.pitch)
      }
      if (pos > humStart + 1 * sr) humLevel = Math.min(humLevel, a.level)
    },
  })
  voicePitch = voicePitch.filter((p) => p > 0)
  const vp = voicePitch.reduce((s, p) => s + p, 0) / Math.max(1, voicePitch.length)
  check(hissLevel < QUIET_LEVEL && hissQuiet > 1, `hiss alone (RMS 0.002): level ≤ ${f3(hissLevel, 3)}, listening (floor ${f3(a.noiseFloor * 1000, 2)}e-3 at the end)`)
  check(voiceLevel > 0.3 && Math.abs(vp - 150) < 2, `a quiet voice over it (RMS 0.01): level ≥ ${f3(voiceLevel, 2)}, pitch ${f3(vp, 1)} Hz`)
  check(humLevel > 0.3, `a 26 s steady vowel over the hiss is never gated as noise (level ≥ ${f3(humLevel, 2)})`)
}
{
  // switching from loud narration to a quiet microphone: the auto gain re-acquires at once
  const sr = 48000
  const loud = tone(sr, 3 * sr, 13)
  for (let i = 0; i < loud.length; i++) loud[i] *= 10 // peak ≈ 0.8
  const quiet = sawtooth(sr, 150, 3 * sr, 0, 0.05, 0.002, mulberry32(14))
  const a = new VoiceAnalysis(sr)
  feed(a, loud, () => 800, 120, { serial: 1 })
  const before = a.ampPeak
  const curve = new VoiceCurve()
  a.adaptiveFloor = true
  feed(a, quiet, () => 800, 2, { serial: 2 })
  curve.update(a, 1.6, 2.4)
  let maxR = 0
  for (let i = 0; i < curve.count; i++) maxR = Math.max(maxR, Math.hypot(curve.points[i * 3], curve.points[i * 3 + 1], curve.points[i * 3 + 2]))
  check(maxR > 1.0 && a.level > 0.9, `loud source (peak ${f3(before, 2)}) → quiet mic (peak 0.05): full size within 2 frames (radius ${f3(maxR, 2)}, level ${f3(a.level, 2)})`)
}
{
  // cost per frame: ingest + follow + curve, 60 fps reads of the vowel
  const sr = 48000
  const sig = tone(sr, 12 * sr, 2)
  const a = new VoiceAnalysis(sr)
  const curve = new VoiceCurve()
  const seg = new Float32Array(POINTS * 6)
  feed(a, sig, () => 800, 60)
  const t0 = performance.now()
  const frames = 500
  feed(a, sig, () => 800, frames, {
    start: WINDOW + 60 * 800,
    onFrame: () => {
      curve.update(a, 1.6, 2.4)
      const p = curve.points
      for (let j = 0, i = 0; j < curve.count - 1; j++, i += 3) seg.set(p.subarray(i, i + 6), j * 6)
    },
  })
  const ms = (performance.now() - t0) / frames
  check(ms < 2, `analysis + 6000-point curve: ${f3(ms, 3)} ms per frame on this machine`)
}

// ---------------------------------------------------------------- 6. size and framing

console.log('\n6. extent at size 2.4, τ = 1.6 ms, and framing at fov 40')
interface Shape {
  name: string
  signal: Float32Array
  source: 'narration' | 'mic' | 'tone'
}
const SR = 48000
const shapes: Shape[] = [
  { name: 'vowel (the tone)', signal: tone(SR, 3 * SR, 31), source: 'tone' },
  { name: '118 Hz sine', signal: Float32Array.from({ length: 3 * SR }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 118 * i) / SR)), source: 'tone' },
  { name: '150 Hz sawtooth', signal: sawtooth(SR, 150, 3 * SR, 0, 0.2, 0.004, mulberry32(3)), source: 'narration' },
  { name: 'hiss ("sss")', signal: white(3 * SR, 0.05, mulberry32(6)), source: 'narration' },
]
const SIZE = 2.4
const TAN = Math.tan((20 * Math.PI) / 180)
const ASPECT = 16 / 9
const POSE = { position: [0, 0.6, 4.4], target: [0, 0, 0] }

function settle(shape: Shape, delayMs = 1.6): { a: VoiceAnalysis; curve: VoiceCurve } {
  const a = new VoiceAnalysis(SR)
  a.adaptiveFloor = shape.source === 'mic'
  feed(a, shape.signal, () => 800, 150)
  const curve = new VoiceCurve()
  curve.update(a, delayMs, SIZE)
  return { a, curve }
}

/** camera basis looking from `pos` at `target`, +Y up */
function basis(pos: number[], target: number[]) {
  const f = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]
  const fl = Math.hypot(f[0], f[1], f[2])
  for (let i = 0; i < 3; i++) f[i] /= fl
  const r = [-f[2], 0, f[0]] // f × (0,1,0)
  const rl = Math.hypot(r[0], r[2])
  r[0] /= rl
  r[2] /= rl
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
  return { f, r, u }
}

let worstSphere = 0
let worstHalfY = 0
for (const shape of shapes) {
  const { curve } = settle(shape)
  const p = curve.points
  let maxY = 0
  let maxH = 0
  let maxR = 0
  for (let i = 0; i < curve.count; i++) {
    if (curve.brightness[i] < 0.02) continue
    const x = p[i * 3]
    const y = p[i * 3 + 1]
    const z = p[i * 3 + 2]
    maxY = Math.max(maxY, Math.abs(y))
    maxH = Math.max(maxH, Math.hypot(x, z))
    maxR = Math.max(maxR, Math.hypot(x, y, z))
  }
  // worst projected extent over a full orbit of the chapter's pose (it auto-rotates about Y)
  let ndcY = 0
  let ndcX = 0
  for (let k = 0; k < 72; k++) {
    const ang = (k / 72) * Math.PI * 2
    const pos = [Math.sin(ang) * POSE.position[2], POSE.position[1], Math.cos(ang) * POSE.position[2]]
    const { f, r, u } = basis(pos, POSE.target)
    for (let i = 0; i < curve.count; i += 3) {
      if (curve.brightness[i] < 0.02) continue
      const v = [p[i * 3] - pos[0], p[i * 3 + 1] - pos[1], p[i * 3 + 2] - pos[2]]
      const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]
      ndcX = Math.max(ndcX, Math.abs((v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (zc * TAN * ASPECT)))
      ndcY = Math.max(ndcY, Math.abs((v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (zc * TAN)))
    }
  }
  worstSphere = Math.max(worstSphere, maxR)
  worstHalfY = Math.max(worstHalfY, maxY)
  console.log(
    `      ${shape.name.padEnd(18)} |Y| ≤ ${f3(maxY, 2)}  radius from the Y axis ≤ ${f3(maxH, 2)}  sphere ${f3(maxR, 2)}   at the chapter pose over an orbit: ${f3(100 * ndcY, 0)} % of half-height, ${f3(100 * ndcX, 0)} % of half-width (16:9)`,
  )
}
{
  const bound = 0.45 * Math.sqrt(3) * SIZE
  /** distance at which a sphere of radius R fills `fill` of the half-height at fov 40 */
  const dist = (R: number, fill: number) => R / Math.sin(Math.atan(fill * TAN))
  check(worstSphere <= bound * 1.1, `every shape inside the 0.78 × size bound (${f3(worstSphere, 2)} ≤ ${f3(bound, 2)})`)
  console.log(
    `      camera distance, fov 40: ${f3(dist(worstSphere, 0.85), 2)} for the largest measured shape at 85 % of the half-height, ` +
      `${f3(dist(bound, 0.9), 2)} for the hard bound at 90 %, ${f3(dist(worstHalfY, 0.85), 2)} when only the height matters`,
  )
}

// ---------------------------------------------------------------- preview

const previewAt = process.argv.indexOf('--preview')
if (previewAt > 0) {
  const dir = process.argv[previewAt + 1] ?? '/tmp/voice-preview'
  mkdirSync(dir, { recursive: true })
  const W = 960
  const H = 540
  for (const [idx, shape] of shapes.entries()) {
    for (const [poseName, pos] of [
      ['front', POSE.position],
      ['side', [POSE.position[2] * Math.sin(1.1), POSE.position[1], POSE.position[2] * Math.cos(1.1)]],
    ] as const) {
      const { a, curve } = settle(shape)
      const img = new Float32Array(W * H * 3)
      const { f, r, u } = basis(pos as number[], POSE.target)
      const project = (x: number, y: number, z: number): [number, number] => {
        const v = [x - pos[0], y - pos[1], z - pos[2]]
        const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]
        const nx = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (zc * TAN * ASPECT)
        const ny = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (zc * TAN)
        return [(nx * 0.5 + 0.5) * W, (0.5 - ny * 0.5) * H]
      }
      const tint = speedColorInto(TINT_CLEAN + (TINT_ROUGH - TINT_CLEAN) * a.roughness, { r: 0, g: 0, b: 0 })
      const vis = smoothstep(0.5 * QUIET_LEVEL, 2.5 * QUIET_LEVEL, a.level)
      const col = [tint.r * CURVE_GAIN * vis, tint.g * CURVE_GAIN * vis, tint.b * CURVE_GAIN * vis]
      const sigma = 0.5 * (LINE_PX / 1.4)
      const splat = (px: number, py: number, w: number, c: number[], s: number) => {
        const R = Math.ceil(3 * s)
        const x0 = Math.round(px)
        const y0 = Math.round(py)
        const k = w / (2 * Math.PI * s * s)
        for (let yy = y0 - R; yy <= y0 + R; yy++) {
          if (yy < 0 || yy >= H) continue
          for (let xx = x0 - R; xx <= x0 + R; xx++) {
            if (xx < 0 || xx >= W) continue
            const g = k * Math.exp(-((xx - px) ** 2 + (yy - py) ** 2) / (2 * s * s))
            const o = (yy * W + xx) * 3
            img[o] += c[0] * g
            img[o + 1] += c[1] * g
            img[o + 2] += c[2] * g
          }
        }
      }
      const p = curve.points
      for (let i = 0; i + 1 < curve.count; i++) {
        const [ax, ay] = project(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
        const [bx, by] = project(p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5])
        const len = Math.hypot(bx - ax, by - ay)
        const steps = Math.max(1, Math.ceil(len / 0.5))
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps
          const b = (curve.brightness[i] + (curve.brightness[i + 1] - curve.brightness[i]) * t) * curve.segment[i]
          // a box line of width LINE_PX and brightness b integrates to LINE_PX · b across
          splat(ax + (bx - ax) * t, ay + (by - ay) * t, b * LINE_PX * (len / steps), col, sigma)
        }
      }
      const k = (curve.count - 1) * 3
      const [hx, hy] = project(p[k], p[k + 1], p[k + 2])
      const hc = [0, 1, 2].map((j) => ([tint.r, tint.g, tint.b][j] * (1 - HEAD_WHITEN) + HEAD_WHITEN) * HEAD_GAIN * vis)
      splat(hx, hy, 60, hc, 2.2)
      const rgb = new Uint8Array(W * H * 3)
      for (let i = 0; i < rgb.length; i++) {
        const x = 1 - Math.exp(-img[i] * 1.6)
        rgb[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))
      }
      const file = join(dir, `voice-${idx}-${poseName}.png`)
      writePng(file, W, H, rgb)
      console.log(`      preview ${file}  (${shape.name}, ${poseName}, roughness ${f3(a.roughness, 2)})`)
    }
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)

function writePng(path: string, w: number, h: number, rgb: Uint8Array) {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(Buffer.from(type, 'ascii'), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 2
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]
  writeFileSync(path, Buffer.concat(parts))
}
