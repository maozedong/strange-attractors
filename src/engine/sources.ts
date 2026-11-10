/**
 * Dust sources: where the particles are told to be.
 *
 *  FlowSource    a strange attractor, integrated on the GPU (wraps SwarmSim)
 *  PointsSource  positions computed on the CPU (text, coastlines, flocks, anything)
 *
 * Other sources (the chaos game, the logistic cloud) live beside the scenes that use them and
 * implement the same DustSource interface.
 */
import * as THREE from 'three'
import type { DustSource } from './Dust'
import { SwarmSim } from '../sim/SwarmSim'
import { SYSTEMS, defaultParams, getSystem, systemIndex } from '../systems'
import type { AttractorSystem, SystemId, Vec3 } from '../types'
import { rampColor, type Palette } from './palettes'

const copyVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
const copyFrag = /* glsl */ `
uniform sampler2D uSource;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uSource, vUv);
}
`

/** Copies one float texture into a render target: how a source remembers last frame. */
export class Blit {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: copyVert,
    fragmentShader: copyFrag,
    uniforms: { uSource: { value: null } },
    depthTest: false,
    depthWrite: false,
  })
  constructor() {
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
  }
  copy(renderer: THREE.WebGLRenderer, source: THREE.Texture, target: THREE.WebGLRenderTarget) {
    const saved = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    this.material.uniforms.uSource.value = source
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(saved)
    renderer.autoClear = autoClear
  }
  dispose() {
    this.material.dispose()
  }
}

export function floatTarget(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}

const sharedBlit = new Blit()

/** z-up system coordinates → y-up world: (x, y, z) ↦ (x, z, −y) */
const Z_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2)

/** wheel used when particles are painted by where they started */
function hueToLinear(h: number, out: Float32Array, o: number) {
  const k = (n: number) => {
    const p = Math.abs((((h + n) % 1) + 1) % 1 * 6 - 3)
    return Math.min(1, Math.max(0, p - 1)) * 0.92 + 0.08
  }
  // sRGB wheel, stored linear
  out[o] = Math.pow(k(0), 2.2)
  out[o + 1] = Math.pow(k(2 / 3), 2.2)
  out[o + 2] = Math.pow(k(1 / 3), 2.2)
  out[o + 3] = 1
}

/** A strange attractor: every particle obeys the same three equations. */
export class FlowSource implements DustSource {
  readonly matrix = new THREE.Matrix4()
  readonly sim: SwarmSim
  /** per-particle colour by starting position, refreshed on every spawn */
  readonly paint: THREE.DataTexture
  /** playback rate multiplier on top of the system's own rate */
  speed = 1
  paused = false
  /** simulated time since the last spawn, system units */
  simTime = 0
  /** when set, starting positions are painted along this act's ramp instead of a colour wheel */
  palette: Palette | null = null

  private readonly renderer: THREE.WebGLRenderer
  private readonly prev: THREE.WebGLRenderTarget
  private sys: AttractorSystem
  private P: number[]
  private owed = 0
  private warpSteps = 0
  private warpPerFrame = 0

  constructor(renderer: THREE.WebGLRenderer, size: number, id: SystemId = 'lorenz', params?: number[]) {
    this.renderer = renderer
    this.sim = new SwarmSim(renderer, size)
    this.prev = floatTarget(size)
    this.paint = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType)
    this.sys = getSystem(id)
    this.P = params ? params.slice() : defaultParams(this.sys)
    this.sim.setSystem(systemIndex(id), this.sys, this.P)
    this.frame()
    this.spawnAttractor()
  }

  get texture() {
    return this.sim.texture
  }

  get prevTexture() {
    return this.prev.texture
  }

  get system(): AttractorSystem {
    return this.sys
  }

  get params(): number[] {
    return this.P
  }

  /** the speed that maps to the hot end of the ramp */
  get speedNorm(): number {
    return this.sys.speedNorm(this.P)
  }

  setSystem(id: SystemId, params?: number[]) {
    this.sys = getSystem(id)
    this.P = params ? params.slice() : defaultParams(this.sys)
    this.sim.setSystem(systemIndex(id), this.sys, this.P)
    this.frame()
  }

  setParam(index: number, value: number) {
    if (this.P[index] === value) return
    this.P[index] = value
    this.sim.setParams(this.sys, this.P)
    this.frame()
  }

  /** every particle in a tiny ball: the swarm experiment */
  spawnCloud(center: Vec3, radius: number) {
    this.sim.spawnCloud(center, radius)
    this.afterSpawn()
  }

  /** every particle already on the attractor */
  spawnAttractor() {
    this.sim.spawnAttractor(this.sys, this.P)
    this.afterSpawn()
  }

  /** run `units` of system time over about `frames` frames, on top of normal playback */
  warp(units: number, frames = 30) {
    this.warpSteps += Math.round(units / this.sys.dt)
    this.warpPerFrame = Math.max(1, Math.ceil(this.warpSteps / Math.max(1, frames)))
  }

  /** world position of a point given in system coordinates */
  toWorld(p: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(p[0], p[1], p[2]).applyMatrix4(this.matrix)
  }

  update(dt: number, time: number) {
    sharedBlit.copy(this.renderer, this.sim.texture, this.prev)
    let steps = 0
    if (!this.paused) {
      this.owed += (dt * this.sys.rate * this.speed) / this.sys.dt
      steps = Math.min(48, Math.floor(this.owed))
      this.owed -= steps
      if (this.owed > 48) this.owed = 0
    }
    if (this.warpSteps > 0) {
      const burst = Math.min(this.warpSteps, this.warpPerFrame, 400)
      this.warpSteps -= burst
      steps += burst
    }
    if (steps > 0) {
      this.sim.step(this.sys.dt, steps, time)
      this.simTime += steps * this.sys.dt
    }
  }

  /** rebuild the starting-position colours (after changing `palette`) */
  repaint() {
    const hue = this.sim.hueAttribute.array as Float32Array
    const data = this.paint.image.data as Float32Array
    if (this.palette) {
      // two inks from the act's ramp, a cool one (brightened: blue is dim to the eye) and a warm one, so that
      // neighbours are easy to tell apart once they have been scattered
      const cool = rampColor(this.palette, 0.24).multiplyScalar(2.4)
      const warm = rampColor(this.palette, 0.76)
      const c = new THREE.Color()
      for (let i = 0; i < hue.length; i++) {
        const h = Math.min(1, Math.max(0, (hue[i] - 0.3) / 0.4))
        c.copy(cool).lerp(warm, h * h * (3 - 2 * h))
        const o = i * 4
        data[o] = c.r
        data[o + 1] = c.g
        data[o + 2] = c.b
        data[o + 3] = 1
      }
    } else {
      for (let i = 0; i < hue.length; i++) hueToLinear(hue[i], data, i * 4)
    }
    this.paint.needsUpdate = true
  }

  dispose() {
    this.sim.dispose()
    this.prev.dispose()
    this.paint.dispose()
  }

  private frame() {
    const f = this.sys.frame(this.P)
    this.matrix
      .copy(Z_UP)
      .multiply(new THREE.Matrix4().makeScale(f.scale, f.scale, f.scale))
      .multiply(new THREE.Matrix4().makeTranslation(-f.center[0], -f.center[1], -f.center[2]))
  }

  private afterSpawn() {
    this.simTime = 0
    this.owed = 0
    sharedBlit.copy(this.renderer, this.sim.texture, this.prev)
    this.repaint()
  }
}

/**
 * Particles placed by the CPU. Write xyz (and an aux value in w) into `data`, then `commit()`.
 * With `motion` on, the previous commit is kept so moving points leave streaks.
 */
export class PointsSource implements DustSource {
  readonly matrix = new THREE.Matrix4()
  readonly size: number
  readonly count: number
  /** staging array: write here, then commit() */
  readonly data: Float32Array
  private readonly current: THREE.DataTexture
  private readonly shown: Float32Array
  private readonly last: THREE.DataTexture | null
  private readonly lastData: Float32Array | null

  constructor(size: number, motion = false) {
    this.size = size
    this.count = size * size
    this.data = new Float32Array(this.count * 4)
    // without motion tracking the staging array is the texture's own array (no copies)
    this.shown = motion ? new Float32Array(this.count * 4) : this.data
    this.current = PointsSource.make(this.shown, size)
    this.lastData = motion ? new Float32Array(this.count * 4) : null
    this.last = this.lastData ? PointsSource.make(this.lastData, size) : null
  }

  get texture() {
    return this.current
  }

  get prevTexture() {
    return this.last
  }

  /** upload `data`; with motion tracking the previous upload becomes last frame's state */
  commit() {
    if (this.last && this.lastData) {
      this.lastData.set(this.shown)
      this.last.needsUpdate = true
      this.shown.set(this.data)
    }
    this.current.needsUpdate = true
  }

  /**
   * Fill every particle from a smaller set of points: particle i takes point (i mod n) with a
   * little jitter, so a few thousand samples still use the whole dust.
   */
  fill(points: ArrayLike<number>, stride: number, jitter = 0, aux?: (i: number) => number) {
    const n = Math.floor(points.length / stride)
    if (n === 0) return
    const d = this.data
    let seed = 0x2545f491
    const rand = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return ((seed >>> 0) / 4294967296) * 2 - 1
    }
    for (let i = 0; i < this.count; i++) {
      const k = (i % n) * stride
      const o = i * 4
      d[o] = points[k] + (jitter ? rand() * jitter : 0)
      d[o + 1] = points[k + 1] + (jitter ? rand() * jitter : 0)
      d[o + 2] = (stride > 2 ? points[k + 2] : 0) + (jitter ? rand() * jitter : 0)
      d[o + 3] = aux ? aux(i % n) : stride > 3 ? points[k + 3] : 0
    }
    this.commit()
  }

  dispose() {
    this.current.dispose()
    this.last?.dispose()
  }

  private static make(data: Float32Array, size: number) {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
    t.minFilter = THREE.NearestFilter
    t.magFilter = THREE.NearestFilter
    t.needsUpdate = true
    return t
  }
}

/**
 * Sample `count` points from rendered text: the title is made of the same dust as everything
 * else. Returns xyz triples centred on the origin, `height` world units tall per line.
 */
export function textPoints(lines: string[], family: string, weight: number, count: number, height: number, lineGap = 1.08): Float32Array {
  const px = 220
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const font = `${weight} ${px}px ${family}`
  ctx.font = font
  const widths = lines.map((l) => ctx.measureText(l).width)
  const w = Math.ceil(Math.max(...widths) + px * 0.4)
  const h = Math.ceil(px * lineGap * lines.length + px * 0.5)
  canvas.width = w
  canvas.height = h
  ctx.font = font
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, w / 2, px * 0.95 + i * px * lineGap))
  const alpha = ctx.getImageData(0, 0, w, h).data

  const out = new Float32Array(count * 3)
  const scale = height / px
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let placed = 0
  let guard = 0
  while (placed < count && guard < count * 400) {
    guard++
    const x = rand() * w
    const y = rand() * h
    const a = alpha[(Math.floor(y) * w + Math.floor(x)) * 4 + 3]
    if (a / 255 < rand()) continue
    out[placed * 3] = (x - w / 2) * scale
    out[placed * 3 + 1] = (h / 2 - y) * scale
    out[placed * 3 + 2] = (rand() - 0.5) * 0.012
    placed++
  }
  return out
}

/** defaults for a named system, for scenes that need the numbers without a source */
export function systemDefaults(id: SystemId) {
  const sys = getSystem(id)
  return { sys, params: defaultParams(sys), index: SYSTEMS.indexOf(sys) }
}
