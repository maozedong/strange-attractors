/**
 * Falling into step. A tree of fireflies on a riverbank, every one blinking on its own clock:
 * the Kuramoto model, one oscillator per firefly, each nudged toward the rhythm of the rest.
 * All of it is dust: the branches are faint grains strung along the limbs, each firefly a small
 * knot of grains that lights up when it flashes. The tree stands on still water and the
 * flashes shine back from it.
 */
import * as THREE from 'three'
import { defaultLook, type DustLook } from '../engine/Dust'
import { at, easeInOut, linear, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { criticalCoupling, Kuramoto, MAX_FRAME, SUBSTEPS } from '../world/fireflies/sim'
import { buildTree, TREE_BASE_Y } from '../world/fireflies/tree'
import { readout } from './kit/hud'
import { Plot } from './kit/Plot'
import { FLOOR } from './kit/shared'
import { dataTexture, SpreadSource } from './kit/SpreadSource'

const FIREFLIES = 1500
/** the fireflies' texture is FW × FW */
const FW = 64
/** share of the dust that draws the branches */
const BRANCH_SHARE = 0.3
/** tree units → world */
const SCALE = 0.72
const KC = criticalCoupling()

/** brightness of a flash from the phase: a soft pulse round θ = 0 with a short afterglow */
function flash(theta: number): number {
  const x = 0.5 + 0.5 * Math.cos(theta)
  const x2 = x * x
  const x4 = x2 * x2
  const pulse = x4 * x2
  // the light lingers after the peak (θ just past 0) and has faded before the next
  const after = theta < 3.8 ? 0.36 * Math.exp(-theta * 0.9) : 0
  // never fully dark: between flashes each firefly keeps a faint ember, so a tree in step is still a tree
  return Math.min(1, 0.07 + 0.93 * (pulse + after))
}
/** the clocks the film starts from (chosen so the tree falls into step on the narrator's words) */
const SEED = 7
/** trunk, limbs, branches, twigs: radius (tree units) and how much of the bark's dust each gets per unit length */
const BARK = [
  { radius: 0.03, weight: 3.2 },
  { radius: 0.017, weight: 1.9 },
  { radius: 0.009, weight: 1.2 },
  { radius: 0.004, weight: 0.8 },
]
/** a few fireflies are heard: their flashes pluck notes from one chord */
const VOICES = [
  { fly: 11, freq: 220.0 },
  { fly: 402, freq: 277.18 },
  { fly: 777, freq: 329.63 },
  { fly: 1093, freq: 415.3 },
  { fly: 1388, freq: 493.88 },
]

const frag = /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uFlash;
uniform float uFW;
uniform float uFlies;
uniform float uGlow;

void main() {
  vec4 b = texture2D(uBase, vUv);
  float i = particleIndex();
  if (b.w < 0.0) {
    // bark: dark, lit a little by the tree's own light
    float level = -b.w - 1.0;
    float tone = 0.15 - 0.018 * level + 0.07 * uGlow;
    gl_FragColor = vec4(b.xyz, tone);
    return;
  }
  // every firefly gets an equal share of the rest, whatever their number
  float fly = mod(b.w, uFlies);
  vec2 uv = vec2(mod(fly, uFW) + 0.5, floor(fly / uFW) + 0.5) / uFW;
  float f = texture2D(uFlash, uv).r;
  // each firefly drifts a little round its perch
  float s = fly * 1.618;
  vec3 drift = 0.018 * vec3(sin(uTime * 0.53 + s), sin(uTime * 0.41 + s * 1.7) * 0.6, cos(uTime * 0.47 + s * 2.3));
  // the knot of light: most grains at the centre, a few in a halo that only shows in a flash
  vec3 off = b.xyz * (0.35 + 0.65 * f);
  float tone = 0.1 + f * (0.9 - 0.3 * min(1.0, length(b.xyz) / 0.03));
  gl_FragColor = vec4(texture2D(uFlash, uv).gba + off + drift, tone);
}
`

const fireflies: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, renderer } = ctx
  const N = ctx.size * ctx.size
  const tree = buildTree(4000)
  const sim = new Kuramoto(FIREFLIES, SEED)
  let flies = FIREFLIES
  let coupling = 0
  let seed = SEED

  // ---------------------------------------------------------------- the static layout
  // fireflies' perches + their flash: r = flash, gba = perch (tree units)
  const flyData = new Float32Array(FW * FW * 4)
  const flyTex = dataTexture(FW, FW, flyData)
  for (let k = 0; k < 4000 && k < FW * FW; k++) {
    flyData[k * 4 + 1] = tree.perches[k * 3]
    flyData[k * 4 + 2] = tree.perches[k * 3 + 1]
    flyData[k * 4 + 3] = tree.perches[k * 3 + 2]
  }

  const baseData = new Float32Array(N * 4)
  let rnd = 0x9e3779b9
  const rand = () => {
    rnd = (rnd + 0x6d2b79f5) | 0
    let t = Math.imul(rnd ^ (rnd >>> 15), 1 | rnd)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand())
  {
    // bark: grains on the limbs, spread round each by its radius, by length and level
    const segs: { a: number[]; b: number[]; level: number; w: number }[] = []
    let total = 0
    tree.segments.forEach((arr, level) => {
      for (let o = 0; o < arr.length; o += 6) {
        const a = [arr[o], arr[o + 1], arr[o + 2]]
        const b = [arr[o + 3], arr[o + 4], arr[o + 5]]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
        total += len * BARK[level].weight
        segs.push({ a, b, level, w: total })
      }
    })
    const barkCount = Math.floor(N * BRANCH_SHARE)
    for (let i = 0; i < N; i++) {
      const o = i * 4
      if (i < barkCount) {
        const x = rand() * total
        let lo = 0
        let hi = segs.length - 1
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (segs[mid].w < x) lo = mid + 1
          else hi = mid
        }
        const sg = segs[lo]
        const u = rand()
        const r = BARK[sg.level].radius * Math.sqrt(rand())
        const ang = rand() * Math.PI * 2
        baseData[o] = sg.a[0] + (sg.b[0] - sg.a[0]) * u + r * Math.cos(ang)
        baseData[o + 1] = sg.a[1] + (sg.b[1] - sg.a[1]) * u + r * 0.3 * gauss()
        baseData[o + 2] = sg.a[2] + (sg.b[2] - sg.a[2]) * u + r * Math.sin(ang)
        baseData[o + 3] = -1 - sg.level
      } else {
        // fireflies: particle k of the rest belongs to firefly k mod 4000, as an offset from its perch
        const k = i - barkCount
        const ring = rand()
        const r = 0.004 + 0.028 * ring * ring
        baseData[o] = gauss() * r * 0.6
        baseData[o + 1] = gauss() * r * 0.6
        baseData[o + 2] = gauss() * r * 0.6
        baseData[o + 3] = k
      }
    }
  }
  const baseTex = dataTexture(ctx.size, ctx.size, baseData)

  const src = new SpreadSource(renderer, ctx.size, frag, {
    uBase: { value: baseTex },
    uFlash: { value: flyTex },
    uFW: { value: FW },
    uFlies: { value: flies },
    uGlow: { value: 0 },
  })
  src.matrix.makeTranslation(0, FLOOR, 0).multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE)).multiply(new THREE.Matrix4().makeTranslation(0, -TREE_BASE_Y, 0))

  const look = (): DustLook => ({
    ...defaultLook(palette),
    size: 0.0028,
    minPx: 0.6,
    gain: 0.42,
    streak: 0,
    tone: 'aux',
    toneBias: 0,
    toneScale: 1,
    twinkle: 0,
  })

  // ---------------------------------------------------------------- the clocks
  let glow = 0
  const lastTheta = new Float64Array(VOICES.length)
  let notesThisSecond = 0
  let noteClock = 0
  const voicePan = VOICES.map((v) => Math.max(-0.8, Math.min(0.8, tree.perches[v.fly * 3] / 1.3)))

  const writeFlashes = () => {
    const n = sim.count
    let sum = 0
    for (let k = 0; k < n; k++) {
      const v = flash(sim.theta[k])
      flyData[k * 4] = v
      sum += v
    }
    glow = sum / n
    flyTex.needsUpdate = true
    src.uniforms.uGlow.value = glow
    src.uniforms.uFlies.value = n
  }

  const listen = (dt: number) => {
    noteClock += dt
    if (noteClock > 1) {
      noteClock = 0
      notesThisSecond = 0
    }
    VOICES.forEach((v, j) => {
      if (v.fly >= sim.count) return
      const th = sim.theta[v.fly]
      // a flash is the phase passing 0
      if (th < lastTheta[j] && notesThisSecond < 6 && !ctx.lab) {
        notesThisSecond++
        sound.note(v.freq, { gain: 0.07 + 0.05 * (1 - sim.r), seconds: 2.2, pan: voicePan[j] })
      }
      lastTheta[j] = th
    })
  }

  // ---------------------------------------------------------------- chart and figures
  let plot: Plot | null = null
  let figure: ReturnType<typeof ctx.label> | null = null
  const history: number[] = []
  let sampleClock = 0
  let alive = true
  /** the chart's span, seconds of scene time */
  const SPAN = 40

  const drawPlot = () => {
    if (!plot) return
    const { g, width: w, height: h } = plot
    plot.clear()
    const x0 = 6
    const y0 = h - 8
    const top = 10
    g.lineWidth = 1
    g.strokeStyle = plot.ink(0.22)
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(x0, y0)
    g.lineTo(w, y0)
    g.stroke()
    // all of them together
    g.setLineDash([2, 4])
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(w, top)
    g.stroke()
    g.setLineDash([])
    if (history.length < 2) return
    g.strokeStyle = plot.ink(0.95)
    g.lineWidth = 1.5
    g.beginPath()
    history.forEach((v, i) => {
      const x = x0 + ((i * 0.1) / SPAN) * (w - x0 - 4)
      const y = y0 - v * (y0 - top)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.stroke()
  }

  const showFigures = () => {
    if (!plot) plot = new Plot(engine.labels.root, 'br', 220, 120, 'flashing together')
    if (!figure) figure = readout(ctx)
  }

  /**
   * The model is the same if every clock is turned by the same angle, so the film may turn
   * them all, gently, to put the tree's flash on a word: `shift` radians spread over `seconds`.
   */
  let shiftLeft = 0
  let shiftRate = 0
  const landFlashIn = (seconds: number, spread: number) => {
    let mean = 0
    for (let k = 0; k < sim.count; k++) mean += sim.omega[k]
    mean /= Math.max(1, sim.count)
    const psi = sim.psi + mean * seconds
    const wrapped = Math.atan2(Math.sin(psi), Math.cos(psi))
    shiftLeft = -wrapped
    shiftRate = Math.abs(shiftLeft) / spread
  }
  const applyShift = (dt: number) => {
    if (shiftLeft === 0) return
    const d = Math.sign(shiftLeft) * Math.min(Math.abs(shiftLeft), shiftRate * dt)
    shiftLeft -= d
    if (Math.abs(shiftLeft) < 1e-6) shiftLeft = 0
    const TAU = Math.PI * 2
    for (let k = 0; k < sim.count; k++) {
      const t = sim.theta[k] + d
      sim.theta[k] = t - TAU * Math.floor(t / TAU)
    }
    sim.measure()
  }

  const turn = (to: number, seconds: number, ease = linear) => {
    const from = coupling
    ctx.tween(seconds, (u) => (coupling = from + (to - from) * u), { ease, tag: 'coupling' })
  }

  const scramble = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    sim.reset(flies, seed)
    history.length = 0
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      engine.backdrop.level = 0.55
      sim.reset(flies, SEED)
      writeFlashes()
      src.render(engine.time)
      void dust.morphTo(src, look(), { seconds: 3.2, swirl: 0.9 })
      rig.shot({ target: [0, -0.2, 0], distance: 4.2, azimuth: 24, elevation: 4, fov: 38, orbit: 0.6, aperture: 0.006, focusOffset: 0, portrait: { distance: 3.6, target: [0, -0.1, 0] } }, 3.2)
    },

    cues: [
      at(0, 'whole tree', () => rig.shot({ distance: 3.6, elevation: 6, orbit: 0.8 }, 6)),
      // in among the branches: one clock each
      at(1, () => rig.shot({ target: [0.1, 0.1, 0], distance: 2.3, azimuth: 40, elevation: 3, aperture: 0.012, orbit: 1, portrait: { distance: 2.6, target: [0, 0.1, 0] } }, 5)),
      at(2, () => turn(0.8 * KC, 4, easeInOut)),
      // "Turn that nudge up, slowly"
      at(3, () => {
        showFigures()
        turn(4 * KC, 3.72)
        rig.shot({ target: [0, -0.15, 0], distance: 3.4, elevation: 5, aperture: 0.008, orbit: 1.2 }, 6)
      }),
      at(4, 'Then', () => turn(6 * KC, 3.6, easeInOut)),
      // "And then the whole tree is one light"
      at(5, () => landFlashIn(ctx.until(5, 'one'), 1.4)),
      at(5, 'whole', () => rig.shot({ target: [0, -0.86, 0], distance: 6.2, elevation: 4, aperture: 0.004, orbit: 3, portrait: { distance: 5.4, target: [0, -0.8, 0] } }, 3.2)),
    ],

    explore() {
      // scattered flashing, with the chart up: the nudge is the visitor's to turn
      ctx.after(2.4, () => showFigures())
    },

    update(dt) {
      if (dt > 0) {
        const h = Math.min(dt, MAX_FRAME) / SUBSTEPS
        for (let k = 0; k < SUBSTEPS; k++) sim.step(h, coupling)
        applyShift(dt)
        listen(dt)
        sampleClock += dt
        if (sampleClock >= 0.1) {
          sampleClock -= 0.1
          if (plot) {
            history.push(sim.r)
            if (history.length * 0.1 > SPAN) history.shift()
            drawPlot()
          }
        }
      }
      writeFlashes()
      src.render(engine.time)
      if (alive) figure?.set(`in step  ${Math.round(sim.r * 100)}%`)
    },

    exit() {
      alive = false
      engine.backdrop.level = 1
      plot?.remove()
      ctx.cancel('coupling')
    },

    dispose() {
      plot?.remove()
      if (dust.source === src) dust.setSource(dust.bake(), { ...dust.look })
      src.dispose()
      flyTex.dispose()
      baseTex.dispose()
    },

    lab: [
      {
        kind: 'slider',
        label: 'Nudge (coupling)',
        min: 0,
        max: 3,
        step: 0.01,
        get: () => coupling,
        set: (v) => {
          ctx.cancel('coupling')
          coupling = v
          showFigures()
        },
        format: (v) => `${(v / KC).toFixed(2)} × critical`,
      },
      { kind: 'action', label: 'Scramble their clocks', run: scramble },
      {
        kind: 'choice',
        label: 'Fireflies',
        options: [
          { value: '300', label: '300' },
          { value: '1500', label: '1,500' },
          { value: '4000', label: '4,000' },
        ],
        get: () => String(flies),
        set: (v) => {
          flies = Number(v)
          sim.resize(flies)
        },
      },
      { kind: 'readout', label: 'In step', get: () => `${Math.round(sim.r * 100)}%` },
    ],
    notes: [
      'Each firefly is a clock: it flashes once a cycle, about every 1.1 seconds, but no two run at quite the same rate. Each one also sees the others and moves its own phase a little toward theirs. This is the model Yoshiki Kuramoto wrote down in 1975, and the strength of that nudge is the only dial.',
      'Below a critical strength, set by how different the clocks are, nothing happens: every nudge is undone by the spread of natural rates. Above it, a small core locks together, and its combined pull recruits the rest. Order appears suddenly, like water freezing, though nothing in any single firefly changed.',
      'The same mathematics describes the pacemaker cells of the heart, crickets chirping in unison, power stations on a grid, and the footsteps that set the Millennium Bridge swaying on its opening day in 2000.',
    ],
  }
}

export default fireflies
