/**
 * The edge of collapse. The Bak–Tang–Wiesenfeld sandpile on a 255 × 255 table: every cell holds
 * 0 to 3 grains; a cell that reaches 4 topples, one grain to each neighbour, and grains pushed
 * over the edge are lost. The dust is the table: each cell is a few grains of light, raised by
 * its height and lit by how full it is; a toppling cell flashes and jumps, so an avalanche is
 * seen as light running across the field. Falling grains are sparks.
 *
 * Toppling order does not change where a pile ends up (the model is abelian), so avalanches
 * are relaxed breadth first and a bounded number of topplings a frame: a big one spreads as a
 * visible front instead of appearing all at once.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../engine/Dust'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { loadCriticalPile } from '../world/sandpile/loader'
import { createPile, loadInterior, mulberry32, SAND_N, type SandJob, type SandJobResult } from '../world/sandpile/pile'
import { plate } from './kit/hud'
import { Plot } from './kit/Plot'
import { dataTexture, SpreadSource } from './kit/SpreadSource'

const N = SAND_N
const CELLS = N * N
/** the table's edge, world units, and its height */
const FIELD = 2.5
const TABLE_Y = -0.62
/** height of one grain */
const GRAIN_H = 0.011
/** seconds a toppled cell glows */
const FLASH_SECONDS = 0.7
/** falling grains in flight at once, how high they fall from, and how long they take */
const SPARKS = 16
const DROP_HEIGHT = 0.75
const FALL_SECONDS = 0.55
/** the single-source pattern, grown through these many snapshots up to the full pile */
const SNAPSHOTS = 14
const IDENTITY_GRAINS = 100_000
const HIST_BINS = 22
/** brightness of one grain on the live table, and in the finished pattern */
const GAIN = 0.34
const GAIN_PATTERN = 0.62

const frag = /* glsl */ `
uniform sampler2D uGrid;
uniform float uN;
uniform float uPerCell;
uniform float uField;
uniform float uGrainH;
uniform float uPat;
uniform float uPatMix;
uniform vec4 uSpark[${SPARKS}];
uniform float uSparkSize;

float liveTone(float g, float heat) {
  float base = g < 0.5 ? 0.03 : g < 1.5 ? 0.11 : g < 2.5 ? 0.18 : 0.26;
  return mix(base, 1.0, heat * heat * (3.0 - 2.0 * heat));
}
float patternTone(float g) {
  return g < 0.5 ? 0.0 : g < 1.5 ? 0.26 : g < 2.5 ? 0.52 : 0.84;
}

vec4 cell(float i) {
  float cells = uN * uN;
  float c = mod(i, cells);
  float cx = mod(c, uN);
  float cy = floor(c / uN);
  vec4 d = texture2D(uGrid, (vec2(cx, cy) + 0.5) / uN);
  // a few grains of light per cell, spread over it
  vec2 jit = vec2(hashI(i, 1.0), hashI(i, 2.0)) - 0.5;
  // in the pattern the grains line up on the cells, so its edges stay sharp
  float sub = floor(i / cells);
  vec2 grid2 = vec2(mod(sub, 2.0), mod(floor(sub / 2.0), 2.0)) * 0.5 - 0.25;
  jit = mix(jit * 0.9, grid2, uPat);
  vec2 xz = ((vec2(cx, cy) + 0.5 + jit) / uN - 0.5) * uField;
  float live = min(d.r, 4.0);
  float pat = mix(d.b, d.a, uPatMix);
  float g = mix(live, pat, uPat);
  float heat = d.g * (1.0 - uPat);
  float y = g * uGrainH + heat * 0.035;
  float tone = mix(liveTone(live, d.g), mix(patternTone(d.b), patternTone(d.a), uPatMix), uPat);
  return vec4(xz.x, y, xz.y, tone);
}

void main() {
  float i = particleIndex();
  float grid = uPerCell * uN * uN;
  if (i >= grid) {
    // the rest of the dust: falling grains
    float k = floor((i - grid) / uSparkSize);
    vec4 s = vec4(0.0, 0.0, 0.0, -1.0);
    for (int j = 0; j < ${SPARKS}; j++) {
      if (float(j) == k) s = uSpark[j];
    }
    if (s.w >= 0.0 && s.w < ${FALL_SECONDS.toFixed(2)}) {
      float u = s.w / ${FALL_SECONDS.toFixed(2)};
      vec3 jit = vec3(hashI(i, 3.0), hashI(i, 4.0), hashI(i, 5.0)) - 0.5;
      vec3 p = vec3(s.x, s.y + ${DROP_HEIGHT.toFixed(2)} * (1.0 - u * u), s.z) + jit * 0.003;
      gl_FragColor = vec4(p, 1.0);
      return;
    }
  }
  gl_FragColor = cell(i);
}
`

/** the worker that builds piles off the main thread (the main thread is the fallback) */
function runJob(job: SandJob): Promise<SandJobResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../world/sandpile/sandpile.worker.ts', import.meta.url), { type: 'module' })
    } catch (e) {
      reject(e)
      return
    }
    worker.onmessage = (event: MessageEvent<SandJobResult>) => {
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      worker.terminate()
      reject(new Error('sandpile worker failed'))
    }
    worker.postMessage(job)
  })
}

/** grains on the centre for snapshot k of the growing pattern (radius grows evenly) */
const snapshotGrains = (k: number) => Math.round(IDENTITY_GRAINS * Math.pow(k / SNAPSHOTS, 2))

const sandpile: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, renderer } = ctx
  const perCell = Math.max(1, Math.floor((ctx.size * ctx.size) / CELLS))
  /** a tall frame is seen from further back, so more grains share a pixel: dim each one */
  const tall = () => (ctx.portrait ? 0.5 : 1)
  const sparkPool = ctx.size * ctx.size - perCell * CELLS
  const sparkSize = Math.max(1, Math.floor(sparkPool / SPARKS))

  // ---------------------------------------------------------------- the pile
  const pile = createPile(N)
  const W = pile.w
  const h = pile.h
  const heat = new Float32Array(h.length)
  /** cells waiting to topple, breadth first (a ring) */
  const queue = new Int32Array(CELLS + 8)
  let qHead = 0
  let qLen = 0
  const queued = new Uint8Array(h.length)
  let avalanche = 0
  let ready = false
  let dirty = true
  let hot = false
  let rand = mulberry32(7)
  let serial = 1

  const push = (i: number) => {
    if (queued[i]) return
    queued[i] = 1
    queue[(qHead + qLen) % queue.length] = i
    qLen++
  }
  /** topple up to `budget` times from the queue; returns how many */
  const relax = (budget: number) => {
    let done = 0
    while (qLen > 0 && done < budget) {
      const i = queue[qHead]
      qHead = (qHead + 1) % queue.length
      qLen--
      queued[i] = 0
      const v = h[i]
      if (v < 4) continue
      const t = v >> 2
      h[i] = v & 3
      done += t
      heat[i] = 1
      h[i - 1] += t
      if (h[i - 1] >= 4) push(i - 1)
      h[i + 1] += t
      if (h[i + 1] >= 4) push(i + 1)
      h[i - W] += t
      if (h[i - W] >= 4) push(i - W)
      h[i + W] += t
      if (h[i + W] >= 4) push(i + W)
    }
    return done
  }
  const siteOf = (x: number, y: number) => (y + 1) * W + x + 1

  /** how big an avalanche a grain on site i would set off now (on a copy) */
  const scratch = new Int32Array(h.length)
  const sQueue = new Int32Array(CELLS + 8)
  const trial = (site: number) => {
    scratch.set(h)
    let head = 0
    let len = 0
    scratch[site]++
    if (scratch[site] < 4) return 0
    sQueue[len++] = site
    let total = 0
    while (len > 0) {
      const i = sQueue[head]
      head = (head + 1) % sQueue.length
      len--
      const v = scratch[i]
      if (v < 4) continue
      const t = v >> 2
      scratch[i] = v & 3
      total += t
      for (let d = 0; d < 4; d++) {
        const j = d === 0 ? i - 1 : d === 1 ? i + 1 : d === 2 ? i - W : i + W
        const was = scratch[j]
        scratch[j] = was + t
        if (was < 4 && was + t >= 4) sQueue[(head + len++) % sQueue.length] = j
      }
    }
    return total
  }

  // ---------------------------------------------------------------- the textures
  const gridData = new Float32Array(CELLS * 4)
  const gridTex = dataTexture(N, N, gridData)
  const sparks = Array.from({ length: SPARKS }, () => new THREE.Vector4(0, 0, 0, -1))
  const sparkSites = new Int32Array(SPARKS).fill(-1)
  const src = new SpreadSource(
    renderer,
    ctx.size,
    frag,
    {
      uGrid: { value: gridTex },
      uN: { value: N },
      uPerCell: { value: perCell },
      uField: { value: FIELD },
      uGrainH: { value: GRAIN_H },
      uPat: { value: 0 },
      uPatMix: { value: 0 },
      uSpark: { value: sparks },
      uSparkSize: { value: sparkSize },
    },
    true,
  )
  src.matrix.makeTranslation(0, TABLE_Y, 0)

  const writeGrid = (dt: number) => {
    if (!dirty && !hot) return
    const fade = dt / flashSeconds
    let still = false
    for (let y = 0; y < N; y++) {
      let i = (y + 1) * W + 1
      let k = y * N * 4
      for (let x = 0; x < N; x++, i++, k += 4) {
        const v = h[i]
        gridData[k] = v < 0 ? 0 : v
        const q = heat[i]
        gridData[k + 1] = q
        if (q > 0) {
          const next = q - fade
          heat[i] = next > 0 ? next : 0
          still = true
        }
      }
    }
    hot = still
    dirty = false
    gridTex.needsUpdate = true
  }

  // ---------------------------------------------------------------- driving it
  /** grains per second, and where they land */
  let rate = 1.4
  let middle = false
  let showSparks = true
  /** topplings a frame: small keeps an avalanche visible as a spreading front */
  let budget = 2500
  let owed = 0
  const hist = new Float64Array(HIST_BINS)
  let slides = 0
  /** grains in flight: land on their site after FALL_SECONDS */
  const flights: { site: number; age: number; slot: number }[] = []
  /** while the film wants nothing to happen, grains only land where they cannot topple */
  let quiet = true
  /** the grain that will set off the big slide, once found */
  let bigSite = -1
  let bigSize = 0
  let searched = 0
  let paceBig = 0
  let soundClock = 0
  /** seconds a toppled cell glows (shorter once the pile is pouring fast, so the field does not white out) */
  let flashSeconds = FLASH_SECONDS
  /** sparks fall on the middle as decoration while the pattern grows (they do not land in the pile) */
  let raining = false
  let rainClock = 0
  let soundsThisSecond = 0

  const worldOf = (site: number, out: THREE.Vector3) => {
    const x = (site % W) - 1
    const y = Math.floor(site / W) - 1
    return out.set(((x + 0.5) / N - 0.5) * FIELD, TABLE_Y + Math.max(0, h[site]) * GRAIN_H, ((y + 0.5) / N - 0.5) * FIELD)
  }
  const tmp = new THREE.Vector3()

  const pickSite = () => {
    if (middle) return siteOf((N - 1) >> 1, (N - 1) >> 1)
    for (let tries = 0; tries < 60; tries++) {
      const k = (rand() * CELLS) | 0
      const site = siteOf(k % N, (k / N) | 0)
      if (!quiet || h[site] <= 1) return site
    }
    return siteOf((rand() * N) | 0, (rand() * N) | 0)
  }

  const launch = (site: number) => {
    if (showSparks) {
      for (let slot = 0; slot < SPARKS; slot++) {
        if (sparks[slot].w < 0) {
          worldOf(site, tmp)
          sparks[slot].set(tmp.x, tmp.y - TABLE_Y, tmp.z, 0)
          sparkSites[slot] = site
          flights.push({ site, age: 0, slot })
          return
        }
      }
    }
    land(site)
  }

  const land = (site: number) => {
    h[site]++
    dirty = true
    heat[site] = Math.max(heat[site], 0.55)
    hot = true
    if (h[site] >= 4) push(site)
  }

  const noteFor = (size: number) => {
    if (ctx.lab || size < 6 || soundsThisSecond >= 4) return
    soundsThisSecond++
    const b = Math.log2(size)
    sound.note(660 / Math.pow(2, Math.min(4, b / 4)), { gain: Math.min(0.16, 0.05 + 0.008 * b), seconds: 1.4 + b * 0.12, pan: (rand() - 0.5) * 0.8 })
  }

  const finishAvalanche = () => {
    if (avalanche <= 0) return
    const bin = Math.min(HIST_BINS - 1, 31 - Math.clz32(avalanche))
    hist[bin]++
    slides++
    noteFor(avalanche)
    avalanche = 0
    plotDirty = true
  }

  const step = (dt: number) => {
    soundClock += dt
    if (soundClock > 1) {
      soundClock = 0
      soundsThisSecond = 0
    }
    // grains in flight
    for (let k = flights.length - 1; k >= 0; k--) {
      const f = flights[k]
      f.age += dt
      sparks[f.slot].w = f.age
      if (f.age >= FALL_SECONDS) {
        sparks[f.slot].w = -1
        flights.splice(k, 1)
        if (f.site >= 0) land(f.site)
        if (f.site >= 0 && qLen === 0 && rate < 8 && !ctx.lab) sound.note(1318.5, { gain: 0.025, seconds: 0.5, pan: 0 })
      }
    }
    if (raining) {
      rainClock += dt
      if (rainClock > 0.09) {
        rainClock = 0
        const c = siteOf((N - 1) >> 1, (N - 1) >> 1)
        for (let slot = 0; slot < SPARKS; slot++) {
          if (sparks[slot].w < 0) {
            sparks[slot].set((rand() - 0.5) * 0.01, 0.04, (rand() - 0.5) * 0.01, 0)
            flights.push({ site: -1 - c, age: 0, slot })
            break
          }
        }
      }
    }
    if (!ready) return
    // the avalanche in progress
    let left = paceBig > 0 ? paceBig : budget
    while (left > 0) {
      if (qLen > 0) {
        const done = relax(left)
        avalanche += done
        left -= done
        if (done > 0) {
          dirty = true
          hot = true
        }
        if (qLen > 0) break
        if (paceBig > 0) paceBig = 0
        finishAvalanche()
      }
      if (owed < 1) break
      owed -= 1
      launch(pickSite())
      if (showSparks) break
    }
    owed = Math.min(owed + rate * dt, 400)
  }

  // ---------------------------------------------------------------- the big slide
  const searchBig = (count: number) => {
    for (let k = 0; k < count; k++) {
      // near the middle, so the whole slide is in the picture
      const site = siteOf(Math.floor(N * (0.25 + 0.5 * rand())), Math.floor(N * (0.25 + 0.5 * rand())))
      if (h[site] !== 3) continue
      searched++
      const s = trial(site)
      // big, but not the whole table: the front should stay readable
      if (s > bigSize && s < CELLS * 3.5) {
        bigSize = s
        bigSite = site
      }
    }
  }

  // ---------------------------------------------------------------- the chart
  let plot: Plot | null = null
  let plotDirty = false
  const drawPlot = () => {
    if (!plot) return
    plotDirty = false
    const { g, width: w, height: ph } = plot
    plot.clear()
    const x0 = 6
    const y0 = ph - 8
    const top = 8
    g.lineWidth = 1
    g.strokeStyle = plot.ink(0.22)
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(x0, y0)
    g.lineTo(w, y0)
    g.stroke()
    // probability density per bin: count / bin width, both axes logarithmic
    const pts: [number, number][] = []
    for (let b = 0; b < HIST_BINS; b++) if (hist[b] > 0) pts.push([b + 0.5, Math.log2(hist[b] / Math.pow(2, b))])
    if (pts.length < 2) return
    const yMax = Math.max(...pts.map((p) => p[1]))
    const yMin = Math.min(yMax - 24, ...pts.map((p) => p[1]))
    const X = (b: number) => x0 + 4 + (b / (HIST_BINS - 1)) * (w - x0 - 10)
    const Y = (v: number) => top + ((yMax - v) / Math.max(1, yMax - yMin)) * (y0 - top - 4)
    // the straight line through them (least squares over well-filled bins)
    const fit = pts.filter((_, k) => hist[Math.floor(pts[k][0])] >= 3)
    if (fit.length >= 3) {
      const n = fit.length
      const mx = fit.reduce((a, p) => a + p[0], 0) / n
      const my = fit.reduce((a, p) => a + p[1], 0) / n
      const sxx = fit.reduce((a, p) => a + (p[0] - mx) ** 2, 0)
      const sxy = fit.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0)
      const slope = sxy / Math.max(1e-9, sxx)
      g.setLineDash([2, 4])
      g.strokeStyle = plot.ink(0.5)
      g.beginPath()
      g.moveTo(X(0), Y(my + slope * (0 - mx)))
      g.lineTo(X(HIST_BINS - 1), Y(my + slope * (HIST_BINS - 1 - mx)))
      g.stroke()
      g.setLineDash([])
    }
    g.fillStyle = plot.ink(0.95)
    for (const [b, v] of pts) {
      g.beginPath()
      g.arc(X(b), Y(v), 2, 0, Math.PI * 2)
      g.fill()
    }
    plot.setValue(`${slides.toLocaleString('en-US')} slides`)
  }

  // ---------------------------------------------------------------- the single-source pattern
  const snapshots: (Uint8Array | null)[] = new Array(SNAPSHOTS + 1).fill(null)
  snapshots[0] = new Uint8Array(CELLS)
  let alive = true
  const buildSnapshots = async () => {
    // the full pattern first: it is the one the film cannot do without
    for (const k of [SNAPSHOTS, ...Array.from({ length: SNAPSHOTS - 1 }, (_, j) => j + 1)]) {
      if (!alive) return
      try {
        const r = await runJob({ kind: 'identity', n: N, grains: snapshotGrains(k) })
        snapshots[k] = r.grid
      } catch {
        return
      }
    }
  }
  /** pattern position 0..SNAPSHOTS (fractional = between two snapshots) */
  let growth = -1
  let shownA = -1
  let shownB = -1
  const writePatterns = (pos: number) => {
    // nearest snapshots that exist
    let a = Math.floor(pos)
    while (a > 0 && !snapshots[a]) a--
    let b = Math.ceil(pos)
    while (b < SNAPSHOTS && !snapshots[b]) b++
    if (!snapshots[b]) b = a
    const ga = snapshots[a]
    const gb = snapshots[b]
    if (!ga || !gb) return
    if (a !== shownA || b !== shownB) {
      for (let c = 0; c < CELLS; c++) {
        gridData[c * 4 + 2] = ga[c]
        gridData[c * 4 + 3] = gb[c]
      }
      gridTex.needsUpdate = true
      shownA = a
      shownB = b
    }
    src.uniforms.uPatMix.value = b > a ? Math.min(1, Math.max(0, (pos - a) / (b - a))) : 0
  }

  const loadFresh = (seed: number) => {
    ready = false
    loadCriticalPile(seed).then(
      (grid) => {
        if (!alive) return
        loadInterior(pile, grid)
        heat.fill(0)
        qLen = 0
        qHead = 0
        queued.fill(0)
        avalanche = 0
        ready = true
        dirty = true
        searched = 0
        bigSize = 0
        bigSite = -1
      },
      () => undefined,
    )
  }

  const look = (): DustLook => ({
    ...defaultLook(palette),
    size: 0.0027,
    minPx: 0.6,
    gain: GAIN * tall(),
    streak: 0.6,
    tone: 'aux',
    toneBias: 0,
    toneScale: 1,
    twinkle: 0,
  })

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0.5
      loadFresh(serial)
      void buildSnapshots()
      writeGrid(0)
      src.render(engine.time)
      void dust.morphTo(src, look(), { seconds: 3.2, swirl: 0.8 })
      rig.shot({ target: [0, TABLE_Y, 0.1], distance: 3.1, azimuth: 28, elevation: 17, fov: 38, orbit: 0.8, aperture: 0.004, portrait: { distance: 2.8, elevation: 24 } }, 3.2)
    },

    cues: [
      // "a grain tips its neighbour, which tips its neighbours, and a whole slope lets go"
      at(2, 'tips', -FALL_SECONDS, () => {
        if (bigSite < 0 || h[bigSite] !== 3) return
        const seconds = Math.max(2, ctx.until(3) - FALL_SECONDS - 0.2)
        const size = trial(bigSite)
        paceBig = Math.max(30, Math.round(size / (seconds * 60)))
        launch(bigSite)
        worldOf(bigSite, tmp)
        rig.shot({ target: [tmp.x * 0.85, TABLE_Y, tmp.z * 0.85], distance: 2.5, elevation: 22, orbit: 0.6, aperture: 0.004, portrait: { target: [tmp.x, TABLE_Y, tmp.z], distance: 1.6, elevation: 30 } }, 3.4)
        rate = 0
      }),
      at(2, 'lets go', () => sound.sfx('release', 0.35, 0.8)),
      // "Small slides are common. Huge ones are rare."
      at(3, () => {
        quiet = false
        showSparks = false
        rate = 40
        budget = 60000
        flashSeconds = 0.32
        plot = new Plot(engine.labels.root, 'br', 220, 120, 'avalanche sizes')
        rig.shot({ target: [0, TABLE_Y, 0.1], distance: 3.0, azimuth: 10, elevation: 15, orbit: 1.2, aperture: 0.004, portrait: { target: [0, TABLE_Y, 0], distance: 2.5, elevation: 26 } }, 5)
      }),
      // "It builds itself to the edge of collapse, and stays there."
      at(5, () => rig.shot({ target: [0, TABLE_Y - 0.05, 0], distance: 3.7, elevation: 12, orbit: 2.2, aperture: 0.003, portrait: { target: [0, TABLE_Y, 0], distance: 2.8, elevation: 24 } }, 6)),
      // "drop every grain on the same spot"
      at(6, 'same spot', () => {
        rate = 0
        plot?.remove()
        plot = null
        growth = 0
        writePatterns(0)
        const g0 = dust.look.gain
        ctx.tween(1.4, (u) => {
          src.uniforms.uPat.value = u
          dust.look.gain = g0 + (GAIN_PATTERN * tall() - g0) * u
        }, { ease: easeInOut, tag: 'pat' })
        rig.shot({ target: [0, TABLE_Y, 0.42], distance: 4.5, azimuth: 0, elevation: 88, orbit: 0, aperture: 0.0015, portrait: { distance: 3.9, target: [0, TABLE_Y, 0] } }, Math.max(3, ctx.until(7) + 0.5))
        // grains rain on the middle while the pattern grows out from it
        middle = true
        quiet = false
        showSparks = true
        raining = true
        const seconds = Math.max(2.5, ctx.until(7, 'this') - 0.3)
        ctx.tween(seconds, (u) => (growth = u * SNAPSHOTS), { ease: (t) => 1 - Math.pow(1 - t, 1.6), tag: 'grow', done: () => (raining = false) })
      }),
      at(7, 'this', () => {
        plate(ctx, '100,000 grains', 'all dropped on one spot')
      }),
      at(8, () => rig.shot({ distance: 3.9, orbit: 4, portrait: { distance: 3.7 } }, 7)),
    ],

    explore() {
      // sand pouring fast enough for slides of every size, with the chart of their sizes
      ctx.after(2.6, () => {
        rate = 40
        if (!plot) {
          plot = new Plot(engine.labels.root, 'br', 220, 120, 'avalanche sizes')
          plotDirty = true
        }
        quiet = false
        showSparks = false
        budget = 60000
      })
    },

    update(dt) {
      if (dt > 0) step(dt)
      if (ready && quiet && bigSite < 0 && searched < 900) searchBig(60)
      else if (ready && quiet && searched < 2500) searchBig(40)
      writeGrid(dt)
      if (growth >= 0) writePatterns(growth)
      if (plotDirty) drawPlot()
      src.render(engine.time)
    },

    exit() {
      alive = false
      plot?.remove()
      ctx.cancel('grow')
    },

    dispose() {
      alive = false
      plot?.remove()
      if (dust.source === src) dust.setSource(dust.bake(), { ...dust.look })
      src.dispose()
      gridTex.dispose()
    },

    lab: [
      { kind: 'slider', label: 'Grains per second', min: 1, max: 2000, step: 1, get: () => rate, set: (v) => {
        rate = v
        if (!plot) {
          plot = new Plot(engine.labels.root, 'br', 220, 120, 'avalanche sizes')
          plotDirty = true
        }
        quiet = false
        showSparks = v <= 6
        budget = v <= 6 ? 2500 : 60000
        src.uniforms.uPat.value = 0
        growth = -1
        ctx.cancel('pat')
        ctx.cancel('grow')
      }, format: (v) => `${Math.round(v)}` },
      {
        kind: 'choice',
        label: 'Drop grains',
        options: [
          { value: 'anywhere', label: 'Anywhere' },
          { value: 'middle', label: 'On the middle' },
        ],
        get: () => (middle ? 'middle' : 'anywhere'),
        set: (v) => (middle = v === 'middle'),
      },
      { kind: 'action', label: 'Fresh pile', run: () => {
        serial++
        rand = mulberry32(serial * 977)
        hist.fill(0)
        slides = 0
        plotDirty = true
        src.uniforms.uPat.value = 0
        growth = -1
        loadFresh(serial)
      } },
      { kind: 'action', label: 'Show the pattern', run: () => {
        growth = SNAPSHOTS
        writePatterns(SNAPSHOTS)
        ctx.tween(1.2, (u) => (src.uniforms.uPat.value = u), { ease: easeInOut, tag: 'pat' })
      } },
      { kind: 'readout', label: 'Avalanches', get: () => slides.toLocaleString('en-US') },
    ],
    notes: [
      'Per Bak, Chao Tang and Kurt Wiesenfeld introduced this pile in 1987. Each cell holds up to three grains; a fourth makes it topple, passing one grain to each neighbour, which may make them topple in turn. Grains that fall off the edge are gone.',
      'Drop grains at random and the pile fills until it sits at a critical state, where one more grain can do anything from nothing to emptying half the table. Avalanche sizes follow a power law: on logarithmic axes their frequencies fall on a straight line, with no typical size. Nobody set a parameter to get there; the pile organises itself, which is why Bak called it self-organised criticality.',
      'Pour all the grains on one cell instead and the pile spreads into the pattern shown at the end: a fractal of nested, self-similar regions, the same whatever order the grains topple in. This one holds 100,000 grains and was relaxed in your browser while you watched.',
    ],
  }
}

export default sandpile
