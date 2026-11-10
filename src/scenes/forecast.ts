/**
 * Why forecasts come in bulk. A small model of the wind round a latitude (Lorenz-96: forty
 * stations on a ring) runs as one line, the truth. Fifty copies are dropped onto it from fifty
 * slightly different todays; they agree, fray, and by day ten fill the whole range the weather
 * can take. The dust is the ensemble's mist: every grain rides one of the copies, so the cloud
 * is exactly as wide as the forecast is uncertain.
 */
import * as THREE from 'three'
import type { DustSource } from '../engine/Dust'
import { rampColor } from '../engine/palettes'
import { floatTarget } from '../engine/sources'
import { at, easeInOut, easeOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { CLIMATE_SPREAD, L96Ensemble, L96Stepper, L96_DT, L96_N, MAX_MEMBERS, Rng, STEPS_PER_DAY, hash32, l96Tendency } from '../world/forecast/lorenz96'
import { FatSegments, floorMirror } from './kit/FatSegments'
import { readout } from './kit/hud'
import { Plot } from './kit/Plot'
import { FLOOR } from './kit/shared'

const N = L96_N
/** ring radius, the ring's height, and how far a station's value pushes the line out and up */
const RADIUS = 1.12
const BASE_Y = -0.46
const RADIAL = 0.036
const RISE = 0.05
/** crown vertices per station (Catmull-Rom between them) */
const SUB = 4
const VERTS = N * SUB
/** the film's weather: this run's truth, rolled this many 6-hour steps before day 0 */
const SERIAL = 1
const PREROLL = 16
const PERTURBATION = 0.1
/** spread once the copies are unrelated weather (members = 50) */
const CEILING = CLIMATE_SPREAD * Math.sqrt(1 - 1 / 50)
/** chart: days across */
const CHART_DAYS = 18
const MIRROR = 0.035

const SLOTS = MAX_MEMBERS + 1

/** monotone cubic through (time, value) keyframes, flat beyond the ends */
function timetable(keys: [number, number][], t: number): number {
  const n = keys.length
  if (t <= keys[0][0]) return keys[0][1]
  if (t >= keys[n - 1][0]) return keys[n - 1][1]
  let i = 0
  while (i < n - 2 && t > keys[i + 1][0]) i++
  const slope = (a: number) => (keys[a + 1][1] - keys[a][1]) / Math.max(1e-6, keys[a + 1][0] - keys[a][0])
  const tangent = (k: number) => {
    if (k === 0) return slope(0)
    if (k === n - 1) return slope(n - 2)
    const a = slope(k - 1)
    const b = slope(k)
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b)
  }
  const [t0, v0] = keys[i]
  const [t1, v1] = keys[i + 1]
  const h = Math.max(1e-6, t1 - t0)
  const u = (t - t0) / h
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * tangent(i) + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * tangent(i + 1)
}

// ---------------------------------------------------------------- crown geometry

const COS = new Float64Array(VERTS + 1)
const SIN = new Float64Array(VERTS + 1)
for (let k = 0; k <= VERTS; k++) {
  COS[k] = Math.cos((2 * Math.PI * k) / VERTS)
  SIN[k] = Math.sin((2 * Math.PI * k) / VERTS)
}
const W = new Float64Array(SUB * 4)
for (let j = 0; j < SUB; j++) {
  const t = j / SUB
  W[j * 4] = 0.5 * (-t + 2 * t * t - t * t * t)
  W[j * 4 + 1] = 0.5 * (2 - 5 * t * t + 3 * t * t * t)
  W[j * 4 + 2] = 0.5 * (t + 4 * t * t - 3 * t * t * t)
  W[j * 4 + 3] = 0.5 * (-t * t + t * t * t)
}
const crownVals = new Float64Array(VERTS + 1)

/** one state x[xo..xo+N) as a closed wavy ring, written as VERTS segments at out[oo..] */
function writeCrown(x: Float64Array, xo: number, out: Float32Array, oo: number, lift: number) {
  for (let i = 0; i < N; i++) {
    const pm = x[xo + ((i + N - 1) % N)]
    const p0 = x[xo + i]
    const p1 = x[xo + ((i + 1) % N)]
    const p2 = x[xo + ((i + 2) % N)]
    for (let j = 0; j < SUB; j++) {
      const w = j * 4
      crownVals[i * SUB + j] = W[w] * pm + W[w + 1] * p0 + W[w + 2] * p1 + W[w + 3] * p2
    }
  }
  crownVals[VERTS] = crownVals[0]
  let o = oo
  for (let k = 0; k < VERTS; k++) {
    for (let e = 0; e < 2; e++) {
      const q = k + e
      const v = crownVals[q]
      const r = RADIUS + RADIAL * v
      out[o++] = r * COS[q]
      out[o++] = BASE_Y + RISE * v + lift
      out[o++] = -r * SIN[q]
    }
  }
}

// ---------------------------------------------------------------- the ensemble

/** The truth and up to MAX_MEMBERS copies, with a smooth (Hermite) view between 6-hour steps. */
class Forecast {
  readonly truth = new Float64Array(N)
  readonly xs = new Float64Array(MAX_MEMBERS * N)
  count = 0
  steps = 0
  spread = 0
  /** fraction of the way through the next step the picture is drawn at */
  acc = 0
  /** drawn states by slot (0 = truth, k + 1 = member k) and the mean of the drawn members */
  readonly view = new Float64Array(SLOTS * N)
  readonly viewMean = new Float64Array(N)
  private readonly x0 = new Float64Array(SLOTS * N)
  private readonly f0 = new Float64Array(SLOTS * N)
  private readonly f1 = new Float64Array(SLOTS * N)
  private hasPrev = false
  private readonly stepper = new L96Stepper()
  private readonly rng = new Rng()
  private readonly mean = new Float64Array(N)

  get day() {
    return (this.steps + this.acc) / STEPS_PER_DAY
  }

  /** a fresh truth for `serial`, rolled `roll` steps past its spin-up; no members */
  begin(serial: number, roll: number) {
    const e = new L96Ensemble()
    e.start({ serial, members: 0, perturbation: 0 })
    this.truth.set(e.truth)
    this.stepper.run(this.truth, roll)
    this.count = 0
    this.steps = 0
    this.acc = 0
    this.hasPrev = false
    this.measure()
    this.blend()
  }

  /** drop `members` copies onto the truth as it is now: day 0 */
  launch(members: number, serial: number) {
    const m = Math.max(0, Math.min(MAX_MEMBERS, Math.round(members)))
    this.rng.seed(hash32(serial) ^ 0x2545f491)
    for (let k = 0; k < m; k++) for (let i = 0; i < N; i++) this.xs[k * N + i] = this.truth[i] + PERTURBATION * this.rng.normal()
    this.count = m
    this.steps = 0
    this.acc = 0
    this.hasPrev = false
    this.measure()
    this.blend()
  }

  /** advance by `steps` (fractional) 6-hour steps */
  advance(steps: number, max = 48) {
    if (steps <= 0) return
    this.acc += steps
    let n = Math.floor(this.acc)
    this.acc -= n
    if (n > max) n = max
    for (let i = 0; i < n; i++) {
      if (i === n - 1) this.capture(this.x0, this.f0)
      this.stepper.step(this.truth)
      for (let k = 0; k < this.count; k++) this.stepper.step(this.xs, k * N)
      this.steps++
    }
    if (n > 0) {
      this.capture(null, this.f1)
      this.hasPrev = true
      this.measure()
    }
    this.blend()
  }

  private capture(x0: Float64Array | null, f: Float64Array) {
    if (x0) x0.set(this.truth)
    l96Tendency(this.truth, 0, f, 0)
    for (let k = 0; k < this.count; k++) {
      if (x0) for (let i = 0; i < N; i++) x0[(k + 1) * N + i] = this.xs[k * N + i]
      l96Tendency(this.xs, k * N, f, (k + 1) * N)
    }
  }

  private measure() {
    const m = this.count
    if (m === 0) {
      this.spread = 0
      return
    }
    const mean = this.mean
    mean.fill(0)
    for (let k = 0; k < m; k++) for (let i = 0; i < N; i++) mean[i] += this.xs[k * N + i] / m
    let s = 0
    for (let k = 0; k < m; k++)
      for (let i = 0; i < N; i++) {
        const d = this.xs[k * N + i] - mean[i]
        s += d * d
      }
    this.spread = Math.sqrt(s / (m * N))
  }

  private blend() {
    const u = this.acc
    const u2 = u * u
    const u3 = u2 * u
    const h00 = 2 * u3 - 3 * u2 + 1
    const h10 = (u3 - 2 * u2 + u) * L96_DT
    const h01 = -2 * u3 + 3 * u2
    const h11 = (u3 - u2) * L96_DT
    const { view, x0, f0, f1 } = this
    for (let q = 0; q <= this.count; q++) {
      const o = q * N
      const x1 = q === 0 ? this.truth : this.xs
      const src = q === 0 ? 0 : (q - 1) * N
      if (this.hasPrev) for (let i = 0; i < N; i++) view[o + i] = h00 * x0[o + i] + h10 * f0[o + i] + h01 * x1[src + i] + h11 * f1[o + i]
      else for (let i = 0; i < N; i++) view[o + i] = x1[src + i]
    }
    const vm = this.viewMean
    if (this.count === 0) {
      for (let i = 0; i < N; i++) vm[i] = view[i]
      return
    }
    vm.fill(0)
    for (let q = 1; q <= this.count; q++) for (let i = 0; i < N; i++) vm[i] += view[q * N + i] / this.count
  }
}

// ---------------------------------------------------------------- the mist (a GPU dust source)

const mistVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const mistFrag = /* glsl */ `
uniform sampler2D uState;
uniform float uRows;
uniform float uMembers;
uniform float uTruthShare;
uniform float uJitter;
uniform float uSize;
uniform float uRadius;
uniform float uRadial;
uniform float uRise;
uniform float uBase;
varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 cell(float row, float i) {
  i = mod(i + 40.0, 40.0);
  return texture2D(uState, vec2((i + 0.5) / 40.0, (row + 0.5) / uRows)).rg;
}

void main() {
  vec2 id = floor(vUv * uSize);
  float h0 = hash(id);
  float h1 = hash(id + 17.17);
  float h2 = hash(id + 41.3);
  float h3 = max(hash(id + 63.7), 1e-4);
  float h4 = hash(id + 88.1);
  float row = (h0 < uTruthShare || uMembers < 0.5) ? 0.0 : 1.0 + min(floor(h1 * uMembers), uMembers - 1.0);
  float s = h2 * 40.0;
  float i = floor(s);
  float t = s - i;
  float pm = cell(row, i - 1.0).r;
  float p0 = cell(row, i).r;
  float p1 = cell(row, i + 1.0).r;
  float p2 = cell(row, i + 2.0).r;
  float t2 = t * t;
  float t3 = t2 * t;
  float v = 0.5 * ((-t + 2.0 * t2 - t3) * pm + (2.0 - 5.0 * t2 + 3.0 * t3) * p0 + (t + 4.0 * t2 - 3.0 * t3) * p1 + (-t2 + t3) * p2);
  float lift = cell(row, 0.0).g;
  // a soft gaussian sleeve round the line
  float g = sqrt(-2.0 * log(h3));
  float gx = g * cos(6.2831853 * h4);
  float gy = g * sin(6.2831853 * h4);
  float a = 6.2831853 * h2;
  float r = uRadius + uRadial * v + uJitter * 0.7 * gx;
  float y = uBase + uRise * v + lift + uJitter * gy;
  float tone = row < 0.5 ? 0.62 + 0.12 * hash(id + 5.5) : 0.36 + 0.24 * hash(id + 5.5);
  gl_FragColor = vec4(r * cos(a), y, -r * sin(a), tone);
}
`

class Mist implements DustSource {
  readonly matrix = new THREE.Matrix4()
  readonly prevTexture = null
  readonly uniforms
  /** row 0 = truth, row k + 1 = member k; r = station value, g = vertical offset of the whole line */
  readonly state = new Float32Array(40 * SLOTS * 4)
  private readonly stateTex: THREE.DataTexture
  private readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly renderer: THREE.WebGLRenderer

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.renderer = renderer
    this.target = floatTarget(size)
    this.stateTex = new THREE.DataTexture(this.state, 40, SLOTS, THREE.RGBAFormat, THREE.FloatType)
    this.stateTex.minFilter = THREE.NearestFilter
    this.stateTex.magFilter = THREE.NearestFilter
    this.stateTex.needsUpdate = true
    this.uniforms = {
      uState: { value: this.stateTex },
      uRows: { value: SLOTS },
      uMembers: { value: 0 },
      uTruthShare: { value: 0.12 },
      uJitter: { value: 0.04 },
      uSize: { value: size },
      uRadius: { value: RADIUS },
      uRadial: { value: RADIAL },
      uRise: { value: RISE },
      uBase: { value: BASE_Y },
    }
    this.material = new THREE.ShaderMaterial({ vertexShader: mistVert, fragmentShader: mistFrag, uniforms: this.uniforms, depthTest: false, depthWrite: false })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
  }

  get texture() {
    return this.target.texture
  }

  /** copy the drawn states (and each line's vertical offset) in */
  load(view: Float64Array, members: number, lift: (row: number) => number) {
    const s = this.state
    for (let q = 0; q <= members; q++) {
      const off = lift(q)
      for (let i = 0; i < N; i++) {
        const o = (q * 40 + i) * 4
        s[o] = view[q * N + i]
        s[o + 1] = off
      }
    }
    this.uniforms.uMembers.value = members
    this.stateTex.needsUpdate = true
  }

  update() {
    const r = this.renderer
    const saved = r.getRenderTarget()
    r.setRenderTarget(this.target)
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
  }

  dispose() {
    this.target.dispose()
    this.stateTex.dispose()
    this.material.dispose()
  }
}

// ---------------------------------------------------------------- the scene

const forecast: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx

  const fc = new Forecast()
  const mist = new Mist(engine.renderer, engine.size)
  let serial = SERIAL
  let members = 50
  let launched = false

  // the dial, the copies, their mean and the truth
  const dial = new FatSegments(VERTS + N, 1, 17)
  const crowds = new FatSegments(MAX_MEMBERS * VERTS, 1, 18)
  const mean = new FatSegments(VERTS, 1.5, 19)
  const truth = new FatSegments(VERTS, 1.7, 20)
  const group = new THREE.Group()
  group.add(dial.line, crowds.line, mean.line, truth.line)
  const mirror = floorMirror(FLOOR)
  mirror.add(crowds.mirror(MIRROR), mean.mirror(MIRROR), truth.mirror(MIRROR))
  root.add(mirror, group)

  const memberColor = rampColor(palette, 0.5)
  const meanColor = rampColor(palette, 0.8).multiplyScalar(1.4)
  const truthColor = rampColor(palette, 1).multiplyScalar(1.5)
  crowds.fillColor(memberColor)
  mean.fillColor(meanColor)
  truth.fillColor(truthColor)
  crowds.commitColors()

  // the dial: the circle the crowns stand on, a tick at every station
  {
    const a = dial.pos
    let o = 0
    for (let k = 0; k < VERTS; k++) {
      a.set([RADIUS * COS[k], BASE_Y, -RADIUS * SIN[k], RADIUS * COS[k + 1], BASE_Y, -RADIUS * SIN[k + 1]], o)
      o += 6
    }
    for (let i = 0; i < N; i++) {
      const c = COS[i * SUB]
      const s = SIN[i * SUB]
      a.set([(RADIUS - 0.03) * c, BASE_Y, -(RADIUS - 0.03) * s, (RADIUS + 0.03) * c, BASE_Y, -(RADIUS + 0.03) * s], o)
      o += 6
    }
    const ring = rampColor(palette, 0.42).multiplyScalar(0.35)
    const tick = rampColor(palette, 0.55).multiplyScalar(0.55)
    dial.fillColor(ring, 0, VERTS)
    dial.fillColor(tick, VERTS, VERTS + N)
    dial.count = VERTS + N
    dial.commit(true)
  }

  /** each copy arrives from a little above or below and settles onto the truth */
  const drop = new Float32Array(MAX_MEMBERS)
  for (let k = 0; k < MAX_MEMBERS; k++) drop[k] = (((k * 0.618034) % 1) - 0.5) * 0.8
  let settle = 1
  const liftOf = (row: number) => (row === 0 ? 0 : drop[row - 1] * (1 - settle))

  let fade = 0
  let crowdFade = 0
  let meanFade = 0
  /** 6-hour steps per real second */
  let pace = 0
  let paceSet = false
  /** (film time, day) keyframes the run follows while the narrator paces it */
  let schedule: [number, number][] | null = null
  /** before day 0, the truth plays a fixed roll-in so the forecast always starts from the same today */
  const roll = new Float64Array((PREROLL + 1) * N)
  let rollAt = 0
  let rollRate = 0

  let plot: Plot | null = null
  let clock: ReturnType<typeof ctx.label> | null = null
  let wall: ReturnType<typeof ctx.label> | null = null
  let markWall = false
  const series: number[] = []
  const seriesDay: number[] = []
  let lastSampled = -1

  const prepare = () => {
    fc.begin(serial, 0)
    const st = new L96Stepper()
    const x = new Float64Array(fc.truth)
    roll.set(x, 0)
    for (let s = 1; s <= PREROLL; s++) {
      st.step(x)
      roll.set(x, s * N)
    }
    rollAt = 0
    launched = false
    series.length = 0
    seriesDay.length = 0
    lastSampled = -1
  }

  const showRoll = () => {
    // smooth through the precomputed roll (cubic between samples)
    const s = Math.min(PREROLL, rollAt)
    const i = Math.min(PREROLL - 1, Math.floor(s))
    const t = s - i
    const im = Math.max(0, i - 1)
    const ip = Math.min(PREROLL, i + 1)
    const ip2 = Math.min(PREROLL, i + 2)
    const t2 = t * t
    const t3 = t2 * t
    for (let k = 0; k < N; k++) {
      const pm = roll[im * N + k]
      const p0 = roll[i * N + k]
      const p1 = roll[ip * N + k]
      const p2 = roll[ip2 * N + k]
      fc.view[k] = 0.5 * ((-t + 2 * t2 - t3) * pm + (2 - 5 * t2 + 3 * t3) * p0 + (t + 4 * t2 - 3 * t3) * p1 + (-t2 + t3) * p2)
    }
  }

  const launch = () => {
    // land exactly on the end of the roll
    fc.begin(serial, PREROLL)
    fc.launch(members, serial)
    launched = true
    series.length = 0
    seriesDay.length = 0
    lastSampled = -1
  }

  const drawPlot = () => {
    if (!plot) return
    const { g, width: w, height: h } = plot
    plot.clear()
    const x0 = 6
    const y0 = h - 10
    const top = 10
    const hi = 4.2
    const xOf = (d: number) => x0 + (d / CHART_DAYS) * (w - x0 - 6)
    const yOf = (v: number) => y0 - (Math.min(hi, v) / hi) * (y0 - top)
    g.lineWidth = 1
    g.strokeStyle = plot.ink(0.22)
    g.beginPath()
    g.moveTo(x0, top)
    g.lineTo(x0, y0)
    g.lineTo(w, y0)
    g.stroke()
    // a tick per week
    for (const d of [7, 14, 21]) {
      g.beginPath()
      g.moveTo(xOf(d), y0)
      g.lineTo(xOf(d), y0 + 4)
      g.stroke()
    }
    // the spread of the weather itself
    g.setLineDash([2, 4])
    g.beginPath()
    g.moveTo(x0, yOf(CEILING))
    g.lineTo(w, yOf(CEILING))
    g.stroke()
    if (markWall) {
      g.strokeStyle = plot.ink(0.4)
      g.beginPath()
      g.moveTo(xOf(14), top - 6)
      g.lineTo(xOf(14), y0)
      g.stroke()
    }
    g.setLineDash([])
    if (series.length < 2) return
    g.strokeStyle = plot.ink(0.95)
    g.lineWidth = 1.5
    g.beginPath()
    for (let i = 0; i < series.length; i++) {
      const x = xOf(Math.min(CHART_DAYS, seriesDay[i]))
      const y = yOf(series[i])
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }

  const openPlot = () => {
    if (plot) return
    plot = new Plot(engine.labels.root, 'br', 220, 110, 'how far the fifty disagree')
    drawPlot()
  }

  /** screen position of a day on the chart, for a note pinned to it */
  const chartPoint = (day: number, v: number): [number, number] => {
    if (!plot) return [0.8, 0.7]
    const r = plot.canvas.getBoundingClientRect()
    const x = r.left + (6 + (day / CHART_DAYS) * (plot.width - 12)) * (r.width / plot.width)
    const y = r.top + (plot.height - 10 - (v / 4.2) * (plot.height - 20)) * (r.height / plot.height)
    return [x / window.innerWidth, y / window.innerHeight]
  }

  prepare()
  showRoll()

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      mist.load(fc.view, 0, liftOf)
      mist.update()
      void dust.morphTo(mist, { ...lookOf(), gain: 0.0 }, { seconds: 3, swirl: 0.9 })
      ctx.tween(3, (u) => (dust.look.gain = 0.035 * u))
      ctx.tween(2.4, (u) => (fade = u), { ease: easeOut })
      rig.shot({ target: [0, BASE_Y + 0.12, 0], distance: 4.7, azimuth: 18, elevation: 21, fov: 38, orbit: 1.1, aperture: 0.004, portrait: { distance: 3.4, elevation: 26, target: [0, BASE_Y - 0.3, 0] } }, 3.2)
    },

    cues: [
      // "Nobody knows exactly what the sky is doing right now": the mist swells round the line
      at(1, () => ctx.tween(2.5, (u) => (mist.uniforms.uJitter.value = 0.04 + 0.08 * u), { ease: easeInOut, tag: 'jitter' })),
      // "fifty slightly different todays": it gathers back in
      at(2, 'fifty times', () => ctx.tween(3, (u) => (mist.uniforms.uJitter.value = 0.12 - 0.1 * u), { ease: easeInOut, tag: 'jitter' })),
      at(3, 'fifty copies', () => {
        launch()
        settle = 0
        ctx.tween(2.6, (u) => (settle = u), { ease: easeInOut })
        ctx.tween(0.8, (u) => (crowdFade = u))
        ctx.tween(2.6, (u) => (meanFade = u))
        rig.shot({ distance: 4.3, elevation: 19, orbit: 1.3, portrait: { distance: 3.3 } }, 4)
        sound.sfx('split', 0.35)
        // then run on a timetable, so each day is reached as it is named
        const t = ctx.time
        const when = (line: number, word?: string) => t + ctx.until(line, word)
        const end = t + ctx.until(8) + 4.6
        schedule = [
          [t + 2.0, 0],
          [when(4), 0.85],
          [when(4) + 1.6, 1.35],
          [when(5), 2.7],
          [when(5) + 1.6, 3.5],
          [when(6), 4.6],
          [when(6, 'ten') + 0.25, 10],
          [when(7), 11.8],
          [when(8, 'two weeks') + 0.3, 14],
          [end, 15.6],
          [end + 6, 17.4],
        ]
      }),
      at(4, () => {
        clock = readout(ctx)
        openPlot()
      }),
      // "a wall": the camera rises to look straight down on the ring
      at(8, () => {
        rig.shot({ target: [0, BASE_Y, 0], distance: 5.7, elevation: 80, orbit: 2.4, portrait: { distance: 3.1 } }, 4.5)
      }),
      at(8, 'two weeks', () => {
        markWall = true
        drawPlot()
        wall = ctx.label('two weeks', { kind: 'note', at: { screen: chartPoint(14, 4.6) }, align: 'above', dy: -2 })
      }),
    ],

    explore() {
      // a forecast already running, one day a second
      ctx.after(2.6, () => {
        serial += 1
        fc.begin(serial, PREROLL)
        fc.launch(members, serial)
        launched = true
        series.length = 0
        seriesDay.length = 0
        lastSampled = -1
        settle = 0
        ctx.tween(1.6, (u) => (settle = u), { ease: easeOut })
        crowdFade = 1
        meanFade = 1
        openPlot()
        if (!clock) clock = readout(ctx)
        if (pace <= 0) pace = STEPS_PER_DAY
      })
    },

    update(dt) {
      if (dt > 0) {
        if (!launched) {
          // the truth breathes through its roll-in until the copies are dropped on it
          if (rollRate === 0) rollRate = PREROLL / Math.max(6, ctx.until(3, 'fifty copies'))
          rollAt = Math.min(PREROLL, rollAt + dt * (ctx.lab ? 2 : rollRate))
          showRoll()
          fc.viewMean.set(fc.view.subarray(0, N))
        } else if (schedule && !ctx.lab) {
          const want = timetable(schedule, ctx.time) * STEPS_PER_DAY - (fc.steps + fc.acc)
          if (want > 0) fc.advance(want)
        } else {
          // in the lab the run keeps going at a day a second until the visitor sets the pace
          if (ctx.lab && pace === 0 && !paceSet) pace = STEPS_PER_DAY
          if (pace > 0) fc.advance(dt * pace)
        }
      }
      if (launched && fc.steps !== lastSampled) {
        lastSampled = fc.steps
        series.push(fc.spread)
        seriesDay.push(fc.steps / STEPS_PER_DAY)
        drawPlot()
      }
      if (launched) {
        clock?.set(`day  ${fc.day.toFixed(1)}`)
      }

      // lines
      const m = launched ? fc.count : 0
      for (let k = 0; k < m; k++) writeCrown(fc.view, (k + 1) * N, crowds.pos, k * VERTS * 6, liftOf(k + 1))
      crowds.count = m * VERTS
      crowds.commit()
      writeCrown(fc.viewMean, 0, mean.pos, 0, 0)
      mean.count = launched ? VERTS : 0
      mean.commit()
      writeCrown(fc.view, 0, truth.pos, 0, 0)
      truth.count = VERTS
      truth.commit()
      // fifty lines on top of one another add up: keep their sum near one bright band
      // while they fall into place each copy is seen on its own, so it may be brighter
      const together = m > 0 ? Math.max(0.06, Math.min(1, 3.2 / m)) : 0
      const per = together + (0.32 - together) * (1 - settle) * (1 - settle)
      crowds.opacity = fade * crowdFade * per * 1.4
      mean.opacity = fade * meanFade * 0.85
      truth.opacity = fade
      dial.opacity = fade
      const dpr = engine.renderer.getPixelRatio()
      for (const l of [dial, crowds, mean, truth]) l.setPixelRatio(dpr)

      mist.load(fc.view, m, liftOf)
    },

    exit() {
      plot?.remove()
      wall?.remove()
      const f0 = fade
      ctx.tween(2, (u) => (fade = f0 * (1 - u)))
    },

    dispose() {
      plot?.remove()
      dial.dispose()
      crowds.dispose()
      mean.dispose()
      truth.dispose()
      mist.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Copies',
        options: [
          { value: '10', label: '10' },
          { value: '50', label: '50' },
          { value: '64', label: '64' },
        ],
        get: () => String(members),
        set: (v) => {
          members = Number(v)
          launch()
          settle = 1
          crowdFade = 1
          meanFade = 1
          openPlot()
          if (!clock) clock = readout(ctx)
          if (pace <= 0) pace = STEPS_PER_DAY
        },
      },
      {
        kind: 'slider',
        label: 'Days per second',
        min: 0,
        max: 4,
        step: 0.05,
        get: () => pace / STEPS_PER_DAY,
        set: (v) => {
          schedule = null
          paceSet = true
          pace = v * STEPS_PER_DAY
        },
        format: (v) => v.toFixed(2),
      },
      {
        kind: 'action',
        label: 'Start a new forecast',
        run: () => {
          serial += 1
          fc.begin(serial, PREROLL)
          fc.launch(members, serial)
          launched = true
          series.length = 0
          seriesDay.length = 0
          lastSampled = -1
          settle = 0
          ctx.tween(1.6, (u) => (settle = u), { ease: easeOut })
          crowdFade = 1
          meanFade = 1
          openPlot()
          if (!clock) clock = readout(ctx)
          if (pace <= 0) pace = STEPS_PER_DAY
        },
      },
      { kind: 'readout', label: 'Day', get: () => (launched ? fc.day.toFixed(1) : '0.0') },
      { kind: 'readout', label: 'Spread', get: () => `${fc.spread.toFixed(2)} of ${CEILING.toFixed(2)}` },
    ],
    notes: [
      'Since 1992 the big forecasting centres have run their weather models not once but as an ensemble: fifty or so copies, each started from a slightly different guess at the present, because the present is never measured exactly. Where the copies agree, the forecast is confident; where they spread, the spread is the forecast.',
      'The model here is one Edward Lorenz built in 1996: forty stations round a circle of latitude, each pushed by its neighbours, damped, and driven. One unit of its time is about five days of real weather. The copies start a tenth of a unit apart; the gap doubles roughly every two days, and by day ten they are as far apart as two random days of weather (the dashed line).',
      'Better measurements help, but only a little. Starting a thousand times closer buys about ten more doublings, a few weeks at most. For the real atmosphere the limit is thought to be around two weeks.',
    ],
  }

  function lookOf() {
    return {
      ...dust.look,
      size: 0.0032,
      minPx: 0.7,
      gain: 0.05,
      opacity: 1,
      streak: 0,
      palette,
      tone: 'aux' as const,
      speedNorm: 1,
      toneBias: 0,
      toneScale: 1,
      paint: null,
      paintMix: 0,
      twinkle: 0.2,
    }
  }
}

export default forecast
