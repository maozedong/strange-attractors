/**
 * Evaluated in the page before any of its own scripts, when the film is being rendered to video
 * (scripts/render/render.ts). Three jobs:
 *
 *   1. A clock that only moves when a frame is rendered. Timers, animation frames,
 *      performance.now and CSS animations all run on it, so a frame that takes half a second to
 *      capture is still exactly one sixtieth of a second of film.
 *   2. Sound is written down instead of played: every narration clip, music change, effect and
 *      note goes into a log with its film time, and the soundtrack is mixed from that log
 *      afterwards (scripts/render/mix.js).
 *   3. The one scene that draws the narrator's voice is fed the recording itself, sample-exact.
 */
;(() => {
  if (window.__cap || !/[?&]cinema\b/.test(location.search)) return

  const real = {
    setTimeout: window.setTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
    fetch: window.fetch.bind(window),
  }

  // ───────────── the clock ─────────────
  let now = 0 // milliseconds of film
  const epoch = Date.now()
  let seq = 1
  const timers = new Map()
  let rafs = new Map()

  window.setTimeout = (fn, ms, ...args) => {
    const id = seq++
    if (typeof fn === 'function') timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args, every: 0 })
    return id
  }
  window.setInterval = (fn, ms, ...args) => {
    const id = seq++
    const every = Math.max(1, Number(ms) || 0)
    if (typeof fn === 'function') timers.set(id, { at: now + every, fn, args, every })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => void timers.delete(id)
  window.requestAnimationFrame = (fn) => {
    const id = seq++
    rafs.set(id, fn)
    return id
  }
  window.cancelAnimationFrame = (id) => void rafs.delete(id)
  performance.now = () => now
  Date.now = () => epoch + now

  function advance(ms) {
    const target = now + ms
    for (;;) {
      let next = null
      let nextId = 0
      for (const [id, t] of timers) {
        if (t.at <= target && (!next || t.at < next.at)) {
          next = t
          nextId = id
        }
      }
      if (!next) break
      now = Math.max(now, next.at)
      if (next.every) next.at += next.every
      else timers.delete(nextId)
      try {
        next.fn(...next.args)
      } catch (e) {
        console.error(e)
      }
    }
    now = target
    const run = rafs
    rafs = new Map()
    for (const fn of run.values()) {
      try {
        fn(now)
      } catch (e) {
        console.error(e)
      }
    }
  }

  // CSS transitions and animations: held, and moved on by hand with the same clock
  const seen = new WeakMap()
  function stepAnimations(ms) {
    for (const a of document.getAnimations()) {
      const at = seen.get(a)
      if (at === undefined) {
        a.pause()
        a.currentTime = 0
        seen.set(a, 0)
        continue
      }
      const t = at + ms
      seen.set(a, t)
      const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity
      if (Number.isFinite(end) && t >= end) a.finish()
      else a.currentTime = t
    }
  }

  // things still on their way from the network hold the clock
  let pending = 0
  window.fetch = (...args) => {
    pending++
    return real.fetch(...args).finally(() => real.setTimeout(() => pending--, 40))
  }
  // images count too (the cat's photograph)
  const NativeImage = window.Image
  window.Image = function (...args) {
    const img = new NativeImage(...args)
    let open = true
    const done = () => {
      if (!open) return
      open = false
      real.setTimeout(() => pending--, 40)
    }
    pending++
    img.addEventListener('load', done, { once: true })
    img.addEventListener('error', done, { once: true })
    real.setTimeout(done, 4000)
    return img
  }
  window.Image.prototype = NativeImage.prototype
  const tick = () => new Promise((r) => real.setTimeout(r, 0))
  /** a turn of the event loop without the timer clamp, for frames nobody will look at */
  const channel = new MessageChannel()
  let woke = null
  channel.port1.onmessage = () => woke?.()
  const blink = () =>
    new Promise((r) => {
      woke = r
      channel.port2.postMessage(0)
    })
  async function settle() {
    await tick()
    await tick()
    for (let i = 0; i < 2000 && pending > 0; i++) await new Promise((r) => real.setTimeout(r, 5))
  }

  // ───────────── sound, written down ─────────────
  const events = []
  const log = (e) => events.push({ t: now / 1000, ...e })
  const RATE = 48000
  /** decoded narration for the scene that draws it: stem → Float32Array (mono, 48 kHz) */
  const pcm = new Map()
  let heard = null // { stem, start } while a clip plays

  async function decode(stem) {
    try {
      const r = await real.fetch(`${document.baseURI.replace(/[^/]*$/, '')}vo/${stem}.mp3`)
      if (!r.ok) return
      const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await r.arrayBuffer())
      const mono = new Float32Array(buf.length)
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c)
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels
      }
      pcm.set(stem, mono)
    } catch (e) {
      console.warn('[capture] could not decode', stem, e)
    }
  }

  const fakeTap = { connect() {}, disconnect() {} }
  const fakeContext = {
    sampleRate: RATE,
    state: 'running',
    get currentTime() {
      return now / 1000
    },
    createAnalyser() {
      return {
        fftSize: 2048,
        smoothingTimeConstant: 0,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(out) {
          const data = heard ? pcm.get(heard.stem) : null
          const end = heard ? Math.floor((now / 1000 - heard.start) * RATE) : 0
          for (let i = 0; i < out.length; i++) {
            const k = end - out.length + i
            out[i] = data && k >= 0 && k < data.length ? data[k] : 0
          }
        },
      }
    },
  }

  let hook = null
  let decoding = Promise.resolve()
  function patch(h) {
    const s = h.sound
    let speaking = null
    s.unlock = () => {}
    s.prefetch = () => {}
    s.preloadVoice = () => {}
    s.setMuted = () => {}
    s.setMusic = (id) => log({ k: 'music', id })
    s.sfx = (name, gain = 1, rate = 1, pan = 0) => log({ k: 'sfx', name, gain, rate, pan })
    s.note = (freq, o = {}) => log({ k: 'note', freq, gain: o.gain, seconds: o.seconds, pan: o.pan, wet: o.wet, type: o.type })
    s.voice = (stem) => {
      const clip = {
        ready: Promise.resolve(),
        play(offset = 0) {
          speaking = clip
          heard = { stem, start: now / 1000 - offset }
          log({ k: 'voice', stem, offset })
        },
        pause() {
          clip.stop()
        },
        stop() {
          if (speaking !== clip) return
          speaking = null
          heard = null
          log({ k: 'voiceStop', stem })
        },
        // no audible clock to follow: the film runs on its own
        get time() {
          return NaN
        },
        get playing() {
          return speaking === clip
        },
      }
      return clip
    }
    for (const [key, value] of [
      ['context', fakeContext],
      ['voiceTap', fakeTap],
      ['output', null],
      ['state', 'running'],
      ['muted', false],
    ]) {
      Object.defineProperty(s, key, { get: () => value, configurable: true })
    }
    decoding = decode('voice-1')
  }

  Object.defineProperty(window, 'strangeAttractors', {
    configurable: true,
    get: () => hook,
    set(v) {
      hook = v
      patch(v)
    },
  })

  // ───────────── what the driver calls ─────────────
  window.__cap = {
    /** move the clock without reporting (loading, warm-up) */
    async pump(ms) {
      advance(ms)
      await settle()
      stepAnimations(ms)
    },
    async ready(ids) {
      if (!hook || !hook.state.getState().ready) return false
      await decoding
      // every scene's code, so nothing is fetched mid-film
      await Promise.all(ids.map((id) => hook.film.module(id)))
      await document.fonts.ready
      return true
    },
    /** one frame of film: returns where the film is and what it asked the sound to do */
    async frame(ms) {
      advance(ms)
      await settle()
      stepAnimations(ms)
      await new Promise((r) => real.raf(() => real.raf(r)))
      const st = hook.state.getState()
      return JSON.stringify({ t: now / 1000, status: st.status, index: st.index, events: events.splice(0) })
    },
    /**
     * Frames nobody keeps, as fast as they will go: until the film reaches scene `until`, ends,
     * or `max` frames have passed. Returns where it stopped and the music that was asked for.
     */
    async skip(ms, until, max) {
      let music = null
      let n = 0
      let st = hook.state.getState()
      while (n < max) {
        advance(ms)
        await blink()
        await blink()
        for (let i = 0; i < 2000 && pending > 0; i++) await new Promise((r) => real.setTimeout(r, 5))
        stepAnimations(ms)
        n++
        for (const e of events.splice(0)) if (e.k === 'music') music = e
        st = hook.state.getState()
        if (st.index >= until || st.status === 'ended') break
        // let the GPU catch its breath
        if (n % 8 === 0) await new Promise((r) => real.raf(r))
      }
      await new Promise((r) => real.raf(r))
      return JSON.stringify({ t: now / 1000, status: st.status, index: st.index, frames: n, music })
    },
    begin(index) {
      hook.film.begin(index, false)
    },
    /** a layer above the film for cards that belong to the video only */
    overlay(id, html, css) {
      let style = document.getElementById('cap-style')
      if (!style) {
        style = document.createElement('style')
        style.id = 'cap-style'
        document.head.append(style)
      }
      if (css) style.textContent += css
      let el = document.getElementById(id)
      if (!el) {
        el = document.createElement('div')
        el.id = id
        document.body.append(el)
      }
      el.innerHTML = html
      return true
    },
    addClass(id, name) {
      document.getElementById(id)?.classList.add(name)
    },
  }
})()
