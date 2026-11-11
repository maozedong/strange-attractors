/**
 * The film's soundtrack, mixed offline from the log a render wrote down (timeline.json). This is
 * the same graph as src/sound/audio.ts (the same buses, levels, ducking, hall, breaths, knocks
 * and plucks), built in an OfflineAudioContext with every sound started at its film time, so the
 * result is sample-exact against the picture. Runs in a page opened by scripts/render/mix.ts.
 */
const LEVEL = { voice: 1, music: 0.5, sfx: 0.7, notes: 0.5 }
const DUCK = 0.42
const RATE = 48000

function impulse(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let last = 0
    for (let i = 0; i < n; i++) {
      const t = i / n
      const white = Math.random() * 2 - 1
      const a = 0.25 + 0.6 * t
      last = last * a + white * (1 - a)
      d[i] = last * Math.pow(1 - t, 2.6)
    }
  }
  return buf
}

async function mix(timeline, mute) {
  const ctx = new OfflineAudioContext(2, Math.ceil(timeline.seconds * RATE), RATE)
  const master = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.knee.value = 6
  limiter.ratio.value = 6
  limiter.attack.value = 0.005
  limiter.release.value = 0.2
  master.connect(limiter).connect(ctx.destination)
  const bus = (name) => {
    const g = ctx.createGain()
    g.gain.value = mute.includes(name) ? 0 : LEVEL[name]
    g.connect(master)
    return g
  }
  const voiceBus = bus('voice')
  const musicBus = bus('music')
  const sfxBus = bus('sfx')
  const noteBus = bus('notes')
  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx, 3.2)
  const wet = ctx.createGain()
  wet.gain.value = 0.5
  reverb.connect(wet).connect(noteBus)

  const cache = new Map()
  const load = (path) => {
    if (!cache.has(path)) {
      cache.set(
        path,
        fetch(`/public/${path}`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((a) => (a ? ctx.decodeAudioData(a) : null)),
      )
    }
    return cache.get(path)
  }
  const events = [...timeline.events].sort((a, b) => a.t - b.t)
  // everything the film asks for, decoded before anything is scheduled
  for (const e of events) {
    if (e.k === 'voice') await load(`vo/${e.stem}.mp3`)
    if (e.k === 'music' && e.id) await load(`music/${e.id}.mp3`)
    if (e.k === 'sfx' && e.name === 'drip') await load('sfx/drip.mp3')
  }

  const noise = ctx.createBuffer(1, RATE * 2, RATE)
  {
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }

  const duck = (on, t) => {
    if (!mute.includes('music')) musicBus.gain.setTargetAtTime(LEVEL.music * (on ? DUCK : 1), t, on ? 0.25 : 0.9)
  }

  const breath = (t, o) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
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
    p.connect(dry).connect(sfxBus)
    const send = ctx.createGain()
    send.gain.value = 0.9
    p.connect(send).connect(reverb)
    src.start(t)
    src.stop(t + o.seconds + 0.05)
  }

  const knock = (t0, freq, gain, pan = 0, delay = 0) => {
    const t = t0 + delay
    const src = ctx.createBufferSource()
    src.buffer = noise
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
    p.connect(sfxBus)
    const send = ctx.createGain()
    send.gain.value = 0.7
    p.connect(send).connect(reverb)
    src.start(t, Math.random() * 1.5)
    src.stop(t + 0.3)
  }

  const recorded = async (t, name, gain, rate, pan) => {
    const buf = await load(`sfx/${name}.mp3`)
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gain
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    const soften = ctx.createBiquadFilter()
    soften.type = 'lowpass'
    soften.frequency.value = 3200
    src.connect(soften).connect(g).connect(p).connect(sfxBus)
    const send = ctx.createGain()
    send.gain.value = 0.5
    p.connect(send).connect(reverb)
    src.start(t)
  }

  const sfx = (t, name, gain = 1, rate = 1, pan = 0) => {
    switch (name) {
      case 'shimmer':
        return breath(t, { seconds: 1.5, from: 380, to: 900, gain: 0.5 * gain, pan })
      case 'rise':
        return breath(t, { seconds: 3.4, from: 230, to: 760, gain: 0.5 * gain, pan })
      case 'release':
        return breath(t, { seconds: 3.0, from: 620, to: 240, gain: 0.7 * gain, pan })
      case 'fold':
        return breath(t, { seconds: 2.8, from: 460, to: 190, gain: 0.6 * gain, pan })
      case 'split':
        knock(t, 430 * rate, 0.5 * gain, pan - 0.25)
        return knock(t, 320 * rate, 0.4 * gain, pan + 0.25, 0.16)
      case 'tick':
        return knock(t, 300 * rate, 0.6 * gain, pan)
      case 'turn':
        return knock(t, 220 * rate, 0.6 * gain, pan)
      default:
        return recorded(t, name, gain, rate, pan)
    }
  }

  const note = (t, e) => {
    const seconds = e.seconds ?? 0.6
    const osc = ctx.createOscillator()
    osc.type = e.type ?? 'sine'
    osc.frequency.value = e.freq
    const g = ctx.createGain()
    const peak = (e.gain ?? 0.2) * 0.5
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    const p = ctx.createStereoPanner()
    p.pan.value = e.pan ?? 0
    osc.connect(g).connect(p)
    p.connect(noteBus)
    const send = ctx.createGain()
    send.gain.value = e.wet ?? 0.6
    p.connect(send).connect(reverb)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
  }

  let music = null
  const fadeOutMusic = (t, seconds) => {
    if (!music) return
    music.gain.gain.setTargetAtTime(0, t, seconds / 3)
    music.src.stop(t + seconds + 0.5)
    music = null
  }
  const voices = new Map()
  const counts = {}

  for (const e of events) {
    const t = e.t
    counts[e.k] = (counts[e.k] ?? 0) + 1
    if (e.k === 'voice') {
      const buf = await load(`vo/${e.stem}.mp3`)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(voiceBus)
      src.start(t, e.offset ?? 0)
      voices.set(e.stem, src)
      duck(true, t)
    } else if (e.k === 'voiceStop') {
      voices.get(e.stem)?.stop(t)
      voices.delete(e.stem)
      duck(false, t)
    } else if (e.k === 'music') {
      if (!e.id) {
        fadeOutMusic(t, 2.5)
        continue
      }
      if (music?.id === e.id) continue
      fadeOutMusic(t, 3)
      const buf = await load(`music/${e.id}.mp3`)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(musicBus)
      gain.gain.setTargetAtTime(1, t + 0.3, 1.4)
      src.start(t)
      music = { src, gain, id: e.id }
    } else if (e.k === 'musicFade') {
      if (music) music.gain.gain.setTargetAtTime(0, t, (e.seconds ?? 4) / 3)
    } else if (e.k === 'sfx') {
      await sfx(t, e.name, e.gain, e.rate, e.pan)
    } else if (e.k === 'note') {
      note(t, e)
    }
  }

  const out = await ctx.startRendering()
  return { out, counts }
}

/** 24-bit PCM */
function wav(buffer) {
  const n = buffer.length
  const ch = buffer.numberOfChannels
  const bytes = new Uint8Array(44 + n * ch * 3)
  const v = new DataView(bytes.buffer)
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + n * ch * 3, true)
  text(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, buffer.sampleRate, true)
  v.setUint32(28, buffer.sampleRate * ch * 3, true)
  v.setUint16(32, ch * 3, true)
  v.setUint16(34, 24, true)
  text(36, 'data')
  v.setUint32(40, n * ch * 3, true)
  const data = []
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      const q = Math.round(s * 8388607)
      bytes[o++] = q & 255
      bytes[o++] = (q >> 8) & 255
      bytes[o++] = (q >> 16) & 255
    }
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

window.run = async (stems) => {
  const timeline = await (await fetch('/timeline.json')).json()
  const report = {}
  for (const [name, mute] of Object.entries(stems)) {
    const { out, counts } = await mix(timeline, mute)
    await fetch(`/out?name=${name}.wav`, { method: 'POST', body: wav(out) })
    report[name] = counts
  }
  return JSON.stringify(report)
}
