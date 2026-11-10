/**
 * Arnold's cat. A photograph made of dust, one particle per pixel (several on a large dust).
 * A step is shown as what it is: the picture slides along one shear, the part that spills out
 * is folded back inside, then the same along the other shear. After two slow steps the
 * particles just jump, and the cat dissolves into noise; at step 192 every pixel is home.
 *
 * The map is applied about the picture's centre (coordinates −128 … 127), so both shears
 * spill symmetrically. That is Arnold's map conjugated by a shift: the same mixing, and on a
 * 256 × 256 grid the same period, 192.
 */
import * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import { PointsSource } from '../engine/sources'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { readout } from './kit/hud'
import { ink } from './kit/shared'

const N = 256
const H = N / 2
/** recurrence period of the map on a 256 × 256 grid */
const PERIOD = 192
/** steps whose picture still shows a ghost of the cat (a quarter or an eighth of the pixels at home) */
const GHOSTS = new Set([24, 48, 72, 96, 120, 144, 168])
/** picture size, world units, and where its centre stands */
const W = 1.5
const PX = W / N
const Y0 = 0.06
/** how far a folded piece lifts off the picture as it is carried back */
const LIFT = 0.1

const CAT_URL = import.meta.env.BASE_URL + 'img/cat.jpg'
/** where the square crop sits in the 960 × 1163 photo (0 = top): keeps the ears */
const CAT_CROP_FOCUS = 0.12

const wrap = (v: number) => ((((v + H) % N) + N) % N) - H

type Phase = 'shearX' | 'foldX' | 'shearY' | 'foldY'

interface Kept {
  src: PointsSource
  paint: THREE.DataTexture
}
const keep = new WeakMap<Engine, Kept>()

function kept(engine: Engine): Kept {
  let k = keep.get(engine)
  if (!k) {
    const size = engine.size
    const paint = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType)
    paint.minFilter = THREE.NearestFilter
    paint.magFilter = THREE.NearestFilter
    k = { src: new PointsSource(size), paint }
    keep.set(engine, k)
  }
  return k
}

// ---------------------------------------------------------------- pictures

function makeCanvas(size: number) {
  const el = document.createElement('canvas')
  el.width = size
  el.height = size
  const ctx = el.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { el, ctx }
}

/** the largest square (at `focusY` vertically), shrunk by halves to N × N; RGBA rows bottom-up */
function squarePixels(source: CanvasImageSource, width: number, height: number, focusY: number, mirror: boolean): Uint8ClampedArray {
  const side = Math.min(width, height)
  let image: CanvasImageSource = source
  let sx = (width - side) / 2
  let sy = (height - side) * focusY
  let size = side
  while (size >= 2 * N) {
    const half = Math.ceil(size / 2)
    const c = makeCanvas(half)
    c.ctx.drawImage(image, sx, sy, size, size, 0, 0, half, half)
    image = c.el
    sx = 0
    sy = 0
    size = half
  }
  const out = makeCanvas(N)
  if (mirror) out.ctx.setTransform(-1, 0, 0, 1, N, 0)
  out.ctx.drawImage(image, sx, sy, size, size, 0, 0, N, N)
  const rgba = out.ctx.getImageData(0, 0, N, N).data
  const pixels = new Uint8ClampedArray(N * N * 4)
  const row = N * 4
  for (let y = 0; y < N; y++) pixels.set(rgba.subarray((N - 1 - y) * row, (N - y) * row), y * row)
  return pixels
}

let catLoad: Promise<Uint8ClampedArray> | null = null
function loadCat(): Promise<Uint8ClampedArray> {
  if (!catLoad) {
    catLoad = (async () => {
      const img = new Image()
      img.decoding = 'async'
      img.src = CAT_URL
      await img.decode()
      return squarePixels(img, img.naturalWidth, img.naturalHeight, CAT_CROP_FOCUS, false)
    })()
    catLoad.catch(() => (catLoad = null))
  }
  return catLoad
}

/** one frame from the front camera, mirrored; the picture stays in this page */
async function grabCamera(): Promise<Uint8ClampedArray> {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) throw new Error('This browser does not give pages access to a camera.')
  const stream = await media.getUserMedia({ video: { facingMode: 'user' }, audio: false })
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    const start = performance.now()
    while (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      if (performance.now() - start > 5000) throw new Error('The camera started but sent no picture.')
      await new Promise((r) => setTimeout(r, 50))
    }
    // let exposure settle
    await new Promise((r) => setTimeout(r, 500))
    return squarePixels(video, video.videoWidth, video.videoHeight, 0.5, true)
  } finally {
    for (const t of stream.getTracks()) t.stop()
    video.srcObject = null
  }
}

// ---------------------------------------------------------------- the scene

const cat: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const { src, paint } = kept(engine)
  const size = src.size
  const count = src.count

  // which pixel each particle belongs to, and where inside it
  const pix = new Uint32Array(count)
  const subX = new Float32Array(count)
  const subY = new Float32Array(count)
  {
    const per = size / N
    let seed = 0x9e3779b9
    const rand = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 4294967296
    }
    for (let i = 0; i < count; i++) {
      const gx = i % size
      const gy = Math.floor(i / size)
      if (per >= 1) {
        const px = Math.floor(gx / per)
        const py = Math.floor(gy / per)
        pix[i] = py * N + px
        // anywhere in its share of the pixel: a regular grid would beat against the screen's
        subX[i] = ((gx % per) + rand()) / per - 0.5
        subY[i] = ((gy % per) + rand()) / per - 0.5
      } else {
        const step = Math.round(1 / per)
        pix[i] = gy * step * N + gx * step
        subX[i] = 0
        subY[i] = 0
      }
    }
  }

  // the map's state: where each pixel of the picture is now (centred integer coordinates)
  const U = new Int16Array(N * N)
  const V = new Int16Array(N * N)
  /** drawn position of every pixel this frame (pixel units, plus a lift) */
  const PXs = new Float32Array(N * N)
  const PYs = new Float32Array(N * N)
  const PZs = new Float32Array(N * N)
  let step = 0
  let phase: Phase | null = null
  let phaseU = 0
  let dirty = true
  let loaded = false

  const home = () => {
    for (let p = 0; p < N * N; p++) {
      U[p] = (p % N) - H
      V[p] = Math.floor(p / N) - H
    }
    step = 0
    phase = null
    dirty = true
  }
  home()

  const applyStep = () => {
    for (let p = 0; p < N * N; p++) {
      const u = wrap(U[p] + V[p])
      U[p] = u
      V[p] = wrap(V[p] + u)
    }
    step = (step % PERIOD) + 1
    dirty = true
  }

  const place = () => {
    const e = easeInOut(phaseU)
    for (let p = 0; p < N * N; p++) {
      let x = U[p]
      let y = V[p]
      let z = 0
      if (phase === 'shearX') x = U[p] + e * V[p]
      else if (phase === 'foldX') {
        const s = U[p] + V[p]
        const w = wrap(s)
        x = s + (w - s) * e
        if (w !== s) z = Math.sin(Math.PI * e) * LIFT
      } else if (phase === 'shearY') y = V[p] + e * U[p]
      else if (phase === 'foldY') {
        const s = V[p] + U[p]
        const w = wrap(s)
        y = s + (w - s) * e
        if (w !== s) z = Math.sin(Math.PI * e) * LIFT
      }
      PXs[p] = x
      PYs[p] = y
      PZs[p] = z
    }
    const d = src.data
    for (let i = 0; i < count; i++) {
      const p = pix[i]
      const o = i * 4
      d[o] = (PXs[p] + 0.5 + subX[i]) * PX
      d[o + 1] = (PYs[p] + 0.5 + subY[i]) * PX + Y0
      d[o + 2] = PZs[p]
      d[o + 3] = 0.8
    }
    src.commit()
    dirty = false
  }

  /** run one whole step as four visible moves, `seconds` long in all */
  /** steps asked for while one is still being shown: they follow it, never cut it short */
  const queued: number[] = []
  const animateStep = (seconds: number, onDone?: () => void) => {
    if (phase) {
      queued.push(seconds)
      return
    }
    const parts: Phase[] = ['shearX', 'foldX', 'shearY', 'foldY']
    const share = [0.3, 0.2, 0.3, 0.2]
    let k = 0
    const next = () => {
      if (k >= parts.length) {
        phase = null
        // the four moves together are one step of the map
        step = (step % PERIOD) + 1
        dirty = true
        onDone?.()
        const more = queued.shift()
        if (more !== undefined) animateStep(Math.max(0.8, more * 0.85))
        return
      }
      const part = parts[k]
      phase = part
      phaseU = 0
      ctx.tween(seconds * share[k], (u) => {
        phaseU = u
        dirty = true
      }, {
        ease: (t) => t,
        tag: 'move',
        done: () => {
          // commit this half of the map
          if (part === 'foldX') for (let p = 0; p < N * N; p++) U[p] = wrap(U[p] + V[p])
          if (part === 'foldY') for (let p = 0; p < N * N; p++) V[p] = wrap(V[p] + U[p])
          k++
          next()
        },
      })
      if (part === 'foldX' || part === 'foldY') sound.sfx('turn', 0.18)
    }
    next()
  }

  /** a step shown move by move is cut short: complete it at once, so the map stays whole */
  const finishMove = () => {
    queued.length = 0
    if (!phase) return
    ctx.cancel('move')
    if (phase === 'shearX' || phase === 'foldX') for (let p = 0; p < N * N; p++) U[p] = wrap(U[p] + V[p])
    for (let p = 0; p < N * N; p++) V[p] = wrap(V[p] + U[p])
    phase = null
    step = (step % PERIOD) + 1
    dirty = true
  }

  // pacing: either a schedule that lands a step on a word, or a steady rate (the lab)
  let schedule: { from: number; to: number; t0: number; t1: number } | null = null
  let rate = 0
  let acc = 0
  let clock = 0
  const runTo = (to: number, seconds: number) => {
    rate = 0
    schedule = { from: step, to, t0: clock, t1: clock + Math.max(0.2, seconds) }
  }

  let figure: ReturnType<typeof ctx.label> | null = null
  const showStep = () => figure?.set(`step ${step} of ${PERIOD}`)

  const setPicture = (pixels: Uint8ClampedArray) => {
    const data = paint.image.data as Float32Array
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    for (let i = 0; i < count; i++) {
      const p = pix[i] * 4
      const o = i * 4
      // graded a touch warm, lifted so the darkest fur still reads as light
      data[o] = 0.012 + lin(pixels[p]) * 1.04
      data[o + 1] = 0.012 + lin(pixels[p + 1])
      data[o + 2] = 0.01 + lin(pixels[p + 2]) * 0.92
      data[o + 3] = 1
    }
    paint.needsUpdate = true
  }

  const look = () => ({
    ...ink(palette),
    paint,
    paintMix: 1,
    streak: 0,
    twinkle: 0.04,
    size: (PX * 0.95 * N) / size,
    minPx: 0.55,
    gain: 1.1,
  })

  /** every pixel flies home: the picture is reset without a pop */
  const restart = () => {
    ctx.cancel('move')
    queued.length = 0
    phase = null
    schedule = null
    rate = 0
    dust.setSource(dust.bake(), { ...dust.look })
    home()
    place()
    void dust.morphTo(src, look(), { seconds: 1.6, swirl: 0.4 })
    showStep()
  }

  let cameraBusy = false
  let cameraNote = ''

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0.35
      home()
      place()
      void loadCat().then((pixels) => {
        setPicture(pixels)
        loaded = true
        void dust.morphTo(src, look(), { seconds: 3, swirl: 0.8 })
      })
      rig.shot({ target: [0, Y0 - 0.02, 0], distance: 3.3, azimuth: 0, elevation: 3, fov: 38, orbit: 0, aperture: 0.002, portrait: { distance: 2.15 } }, 3)
    },

    cues: [
      at(0, () => {
        figure = readout(ctx)
        showStep()
      }),
      // "Stretch it, shear it, and fold whatever spills over back inside." Room for the spill.
      at(0, 'Stretch', -0.2, () => {
        rig.shot({ target: [0, Y0 - 0.05, 0], distance: 5.2, portrait: { distance: 3.7 } }, 1.8)
        animateStep(Math.max(3.6, ctx.until(1) - 0.5))
      }),
      // "Do it again."
      at(1, () => animateStep(Math.max(1.2, ctx.until(2, 'few') - 0.1))),
      // "A few more times, and the cat is gone. Every pixel scattered."
      at(2, 'few', () => {
        rig.shot({ target: [0, Y0 - 0.02, 0], distance: 3.3, portrait: { distance: 2.15 } }, 2.6)
        runTo(13, Math.max(2.5, ctx.until(2, 'gone') + 0.9))
      }),
      // "This is what mixing means. Keep going, and nothing seems to change." … "there she is"
      at(3, () => runTo(PERIOD, ctx.until(5, 'there she is'))),
      at(5, 'there she is', () => {
        sound.sfx('shimmer', 0.5)
      }),
      // "Every pixel, back where it began." Hold, and come closer.
      at(6, () => rig.shot({ target: [0, Y0 - 0.1, 0], distance: 2.95, elevation: 2, portrait: { distance: 1.9 } }, Math.max(8, ctx.until(8) + 4))),
    ],

    explore() {
      // the picture, whole and still: "One step" and the pace are in the drawer
      figure = readout(ctx)
      showStep()
    },

    update(dt) {
      if (dt > 0) clock += dt
      if (phase) {
        // a step is being shown move by move: the schedule waits for it
      } else if (schedule && dt > 0) {
        const s = schedule
        const u = Math.min(1, (clock - s.t0) / (s.t1 - s.t0))
        const want = Math.round(s.from + (s.to - s.from) * u)
        let moved = false
        while (step < want && step < s.to) {
          applyStep()
          moved = true
        }
        // never linger on a step that still shows a ghost of her
        if (moved && GHOSTS.has(step) && step < s.to) applyStep()
        if (step >= s.to) schedule = null
      } else if (rate > 0 && dt > 0) {
        acc += rate * dt
        let n = Math.min(64, Math.floor(acc))
        acc -= Math.floor(acc)
        while (n-- > 0) applyStep()
      }
      if (dirty) place()
      showStep()
    },

    exit() {
      finishMove()
    },

    dispose() {
      // the picture source is kept: the next scene flies out of it
    },

    lab: [
      {
        kind: 'slider',
        label: 'Steps per second',
        min: 0,
        max: 60,
        step: 0.5,
        get: () => rate,
        set: (v) => {
          schedule = null
          finishMove()
          rate = v
        },
        format: (v) => (v === 0 ? 'held' : v.toFixed(1)),
      },
      { kind: 'action', label: 'One step', run: () => {
        schedule = null
        rate = 0
        if (!phase) animateStep(1.6)
      } },
      { kind: 'action', label: 'Start again', run: restart },
      {
        kind: 'action',
        label: 'Use my face',
        run: () => {
          if (cameraBusy) return
          cameraBusy = true
          cameraNote = 'asking for the camera…'
          grabCamera().then(
            (pixels) => {
              cameraBusy = false
              cameraNote = 'your picture (it never leaves this page)'
              setPicture(pixels)
              restart()
            },
            (e: unknown) => {
              cameraBusy = false
              cameraNote = e instanceof Error && e.name === 'NotAllowedError' ? 'camera access was blocked' : 'no camera could be used'
            },
          )
        },
      },
      { kind: 'readout', label: 'Step', get: () => `${step} of ${PERIOD}` },
      { kind: 'readout', label: 'Picture', get: () => cameraNote || (loaded ? 'the cat' : 'loading…') },
    ],
    notes: [
      'Each step is two shears. Slide every row sideways by its own height, and wrap whatever leaves one edge back in at the other; then slide every column up by its own position, and wrap again. No pixel is lost and no two land on the same place: the step only reorders them. Vladimir Arnold drew a cat on a torus to show this in the 1960s.',
      'Because the picture has a finite number of pixels, reordering them over and over must eventually return to the start. On this 256 × 256 grid it takes exactly 192 steps. In between, at steps 48, 96 and 144, faint ghosts of the picture appear; the film skips over them, the lab does not.',
      '"Use my face" takes one frame from your camera and scrambles it instead. The picture stays in this page: it is never uploaded or stored.',
    ],
  }
}

export default cat
