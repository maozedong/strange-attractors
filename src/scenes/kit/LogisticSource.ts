/**
 * The bifurcation diagram as a living thing. Every particle owns one position of the dial and
 * keeps iterating the map there, forever; drawn at (dial, value) the whole dust is the diagram.
 * Where the map settles into a rhythm the particles of a column pile onto a few points and
 * shine; where it is chaotic they spread into a shimmering cloud.
 *
 * Because the particles are computed, not stored, a zoom is only a change of range: narrow the
 * dial range and the same quarter of a million particles redistribute inside it, with endless
 * detail.
 *
 * Source space is the unit square: x = position across the dial range (0..1), y = position in
 * the value range (0..1), z = a little depth jitter. Place it in the world with `matrix`
 * (see `place`). Aux (w) is the raw value, so `tone: 'aux'` shades by height.
 *
 * Two forms of the same map:
 *   'logistic'   x → r x (1 − x)   dial r in [2.8, 4],     value x in [0, 1]
 *   'quadratic'  z → z² + c        dial c in [−2, 0.25],   value z in [−2, 2]
 * The quadratic form is the one that lines up with the real axis of the Mandelbrot set.
 *
 * Optional extras (off unless asked for, so a scene that ignores them sees the plain diagram):
 *  - `pool`: instead of waiting on the reveal's edge, unrevealed particles lie in a flat sheet
 *    (on a floor, say) under their own column and rise into place as the reveal passes them.
 *  - `paint`: a per-particle colour texture for the look's `paint` slot. Each particle is
 *    coloured by the local Lyapunov exponent of its column: where the map keeps a rhythm the
 *    particles pile onto a few lines and are painted dim and cool; where it is chaotic they are
 *    spread thin and painted bright and warm, so lines and cloud read at similar strength.
 *    Call `setPalette` once; tune with `orderGain`.
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import type { Engine } from '../../engine/Engine'
import { rampGlsl, type Palette } from '../../engine/palettes'
import { floatTarget } from '../../engine/sources'

export type LogisticForm = 'logistic' | 'quadratic'

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const frag = /* glsl */ `
uniform sampler2D uState;
uniform float uSize;
uniform vec2 uDial;    // dial range shown
uniform vec2 uValue;   // value range shown
uniform float uReveal; // 0..1 across the dial range
uniform float uForm;   // 0 logistic, 1 quadratic
uniform float uDepth;
uniform float uSeed;
uniform vec3 uPool;    // on (0/1), sheet height, sheet depth (source units)
uniform float uBand;   // width of the rising front, fraction of the dial range
uniform float uSeek;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  // one dial position per particle: its column, spread by a fixed jitter so no columns show
  float u = (cell.x + hash12(cell + 0.37)) / uSize;
  float dial = mix(uDial.x, uDial.y, u);
  float x = texture2D(uState, vUv).w;
  // 12 to 43 steps, at random: a fixed count that is a multiple of a cycle's period would pin
  // every particle to one phase of it, and some branches of the diagram would stay empty (the
  // spread must cover the longest cycle shown, 32 at the deepest fork)
  int steps = 12 + int(floor(hash12(cell + uSeed * 1.37) * 32.0));

  if (uForm < 0.5) {
    if (!(x > 0.0 && x < 1.0)) x = 0.05 + 0.9 * hash12(cell + uSeed);
    for (int i = 0; i < 44; i++) {
      if (i >= steps) break;
      x = dial * x * (1.0 - x);
    }
  } else {
    if (!(abs(x) < 2.0)) x = (hash12(cell + uSeed) - 0.5) * 0.5;
    for (int i = 0; i < 44; i++) {
      if (i >= steps) break;
      x = x * x + dial;
    }
  }

  // in a zoomed view most of an orbit lies outside the window: keep stepping along it until it
  // comes inside, so the particles of a column gather where its orbit crosses the view
  if (uSeek > 0.5) {
    for (int i = 0; i < 96; i++) {
      float w = (x - uValue.x) / (uValue.y - uValue.x);
      if (w >= 0.0 && w <= 1.0) break;
      if (uForm < 0.5) x = dial * x * (1.0 - x);
      else x = x * x + dial;
    }
  }

  // past r = 4 (or c < −2) every orbit escapes: nothing to draw there
  bool lost = !(abs(x) < 1.0e3);
  if (lost) x = uForm < 0.5 ? 0.5 : 0.0;

  float v = (x - uValue.x) / (uValue.y - uValue.x);
  // particles the reveal has not reached wait on its edge; particles outside the value range
  // are sent out of sight
  float shown = min(u, uReveal);
  float z = (hash12(cell + 7.1) - 0.5) * uDepth;
  bool hidden = lost || v < 0.0 || v > 1.0;
  if (hidden) z = 1.0e5;
  vec3 p = vec3(shown, v, z);
  if (uPool.x > 0.5) {
    // waiting in a sheet under its own column; the reveal's front lifts it into place
    float k = clamp((uReveal * (1.0 + uBand) - u) / uBand, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    // soft-edged: a little spill sideways, thickest in the middle
    float spill = (hash12(cell + 8.1) + hash12(cell + 2.6) - 1.0) * 0.08;
    vec3 rest = vec3(u + spill, uPool.y, (hash12(cell + 3.3) + hash12(cell + 5.9) - 1.0) * uPool.z);
    p = hidden ? rest : mix(rest, vec3(u, v, z), k);
  }
  gl_FragColor = vec4(p, x);
}
`

const paintFrag = /* glsl */ `
${rampGlsl}
uniform sampler2D uState;
uniform float uSize;
uniform vec2 uDial;
uniform float uReveal;
uniform float uForm;
uniform vec3 uPool;
uniform float uBand;
uniform vec3 uRamp[5];
uniform float uOrderGain;
uniform vec3 uSpot;    // dial position, width, strength 0..1
uniform vec2 uValue;
uniform float uFeather;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float u = (cell.x + hash12(cell + 0.37)) / uSize;
  float dial = mix(uDial.x, uDial.y, u);
  float x = texture2D(uState, vUv).w;
  // soften the frame's edges when it is a window onto a larger picture
  float v = (x - uValue.x) / (uValue.y - uValue.x);
  float edge = uFeather > 0.0
    ? smoothstep(0.0, uFeather, u) * smoothstep(0.0, uFeather, 1.0 - u) * smoothstep(0.0, uFeather, v) * smoothstep(0.0, uFeather, 1.0 - v)
    : 1.0;
  // the local Lyapunov exponent: the average stretch of a small error per step
  float lam = 0.0;
  for (int i = 0; i < 16; i++) {
    if (uForm < 0.5) {
      lam += log(max(abs(dial * (1.0 - 2.0 * x)), 1.0e-5));
      x = dial * x * (1.0 - x);
    } else {
      lam += log(max(abs(2.0 * x), 1.0e-5));
      x = x * x + dial;
    }
  }
  lam /= 16.0;
  if (!(abs(lam) < 100.0)) lam = 0.0;
  float chaos = smoothstep(-0.35, 0.3, lam);
  float s = hash12(cell + 11.7);
  vec3 col = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], mix(0.5 + 0.12 * s, 0.7 + 0.22 * s, chaos));
  col *= mix(uOrderGain, 1.0, chaos * chaos);
  float sd = (dial - uSpot.x) / max(uSpot.y, 1.0e-6);
  // attention: light the band, let the rest fall back
  col *= mix(1.0 - 0.55 * uSpot.z, 1.0 + 5.0 * uSpot.z, exp(-sd * sd));
  col *= edge;
  if (uPool.x > 0.5) {
    float k = clamp((uReveal * (1.0 + uBand) - u) / uBand, 0.0, 1.0);
    vec3 still = ramp5(uRamp[0], uRamp[1], uRamp[2], uRamp[3], uRamp[4], 0.3 + 0.3 * s) * 0.05;
    // the front itself flares as the particles leave the water
    float flare = 1.0 + 3.0 * k * (1.0 - k);
    col = mix(still, col * flare, k * k);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

export class LogisticSource implements DustSource {
  readonly prevTexture = null
  /** unit square → world; set it, or use `place` */
  readonly matrix = new THREE.Matrix4()
  /** 0..1: how far across the dial range the diagram has been drawn */
  reveal = 1
  /** depth of the slab the points float in, source units */
  depth = 0.01
  /**
   * Where unrevealed particles wait: null = on the reveal's edge (the default); otherwise a
   * sheet at source height `y`, `depth` deep, from which the reveal lifts them into place.
   */
  pool: { y: number; depth: number } | null = null
  /**
   * In a zoomed view, let each particle step along its own orbit (up to 96 steps a frame) until
   * it lands inside the shown ranges, so a narrow window is as full as the whole diagram.
   */
  seek = true
  /** width of the rising front in `pool` mode, as a fraction of the dial range */
  band = 0.07
  /** brightness of the ordered (periodic) parts in `paint`, relative to the chaotic parts */
  orderGain = 0.06
  /** a soft band of light in `paint` around one dial position; the rest dims by `gain` (0 = off, 1 = full) */
  readonly spot = { at: 3, width: 0.05, gain: 0 }
  /** fade `paint` toward the edges of the shown ranges over this fraction (0 = hard edges) */
  feather = 0

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly paintMaterial: THREE.ShaderMaterial
  private readonly paintScene = new THREE.Scene()
  private readonly paintTarget: THREE.WebGLRenderTarget
  private readonly ramp = [0, 1, 2, 3, 4].map(() => new THREE.Color(1, 1, 1))
  private form: LogisticForm = 'logistic'
  private readonly dial = new THREE.Vector2(2.8, 4)
  private readonly value = new THREE.Vector2(0, 1)
  private frame = 0

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.renderer = renderer
    this.read = floatTarget(size)
    this.write = floatTarget(size)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uState: { value: null },
        uSize: { value: size },
        uDial: { value: this.dial },
        uValue: { value: this.value },
        uReveal: { value: 1 },
        uForm: { value: 0 },
        uDepth: { value: 0.01 },
        uSeed: { value: 0 },
        uPool: { value: new THREE.Vector3() },
        uBand: { value: 0.07 },
        uSeek: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
    this.paintTarget = floatTarget(size)
    const u = this.material.uniforms
    this.paintMaterial = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: paintFrag,
      uniforms: {
        uState: { value: null },
        uSize: u.uSize,
        uDial: u.uDial,
        uReveal: u.uReveal,
        uForm: u.uForm,
        uPool: u.uPool,
        uBand: u.uBand,
        uRamp: { value: this.ramp },
        uOrderGain: { value: 0.06 },
        uSpot: { value: new THREE.Vector3() },
        uValue: u.uValue,
        uFeather: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.paintScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.paintMaterial))
    // settle before the first frame is shown
    for (let i = 0; i < 40; i++) this.step()
  }

  get texture() {
    return this.read.texture
  }

  /** per-particle colour for the look's `paint` slot (see the header); call `setPalette` first */
  get paint(): THREE.Texture {
    return this.paintTarget.texture
  }

  /** the ramp `paint` is drawn from */
  setPalette(palette: Palette) {
    for (let i = 0; i < 5; i++) this.ramp[i].copy(palette.ramp[i])
  }

  /** which form of the map; resets the ranges to that form's whole diagram */
  setForm(form: LogisticForm) {
    if (form === this.form) return
    this.form = form
    if (form === 'logistic') {
      this.dial.set(2.8, 4)
      this.value.set(0, 1)
    } else {
      this.dial.set(-2, 0.25)
      this.value.set(-2, 2)
    }
    // values from the other form are out of range for this one: they reseed themselves
    for (let i = 0; i < 40; i++) this.step()
  }

  /** the stretch of the dial shown across the square (a zoom is a narrower range) */
  setDial(min: number, max: number) {
    this.dial.set(min, max)
  }

  /** the stretch of values shown up the square */
  setValue(min: number, max: number) {
    this.value.set(min, max)
  }

  get dialRange(): [number, number] {
    return [this.dial.x, this.dial.y]
  }

  get valueRange(): [number, number] {
    return [this.value.x, this.value.y]
  }

  /** world position of a (dial, value) pair under the current ranges and matrix */
  toWorld(dial: number, value: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out
      .set((dial - this.dial.x) / (this.dial.y - this.dial.x), (value - this.value.x) / (this.value.y - this.value.x), 0)
      .applyMatrix4(this.matrix)
  }

  /**
   * Stand the diagram in the world: `width` × `height` world units, centred on `centre`,
   * upright facing +z. For other attitudes write `matrix` directly.
   */
  place(width: number, height: number, centre: [number, number, number] = [0, 0, 0]) {
    this.matrix
      .makeTranslation(centre[0] - width / 2, centre[1] - height / 2, centre[2])
      .multiply(new THREE.Matrix4().makeScale(width, height, width))
  }

  update(dt: number) {
    if (dt <= 0) return
    this.step()
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.material.dispose()
    this.paintTarget.dispose()
    this.paintMaterial.dispose()
  }

  private step() {
    const r = this.renderer
    const u = this.material.uniforms
    u.uState.value = this.read.texture
    u.uReveal.value = this.reveal
    u.uForm.value = this.form === 'logistic' ? 0 : 1
    u.uDepth.value = this.depth
    u.uSeed.value = (this.frame++ % 977) + 0.5
    ;(u.uPool.value as THREE.Vector3).set(this.pool ? 1 : 0, this.pool?.y ?? 0, this.pool?.depth ?? 0)
    u.uBand.value = Math.max(1e-3, this.band)
    u.uSeek.value = this.seek ? 1 : 0
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(this.write)
    r.render(this.scene, this.camera)
    const t = this.read
    this.read = this.write
    this.write = t
    this.paintMaterial.uniforms.uState.value = this.read.texture
    this.paintMaterial.uniforms.uOrderGain.value = this.orderGain
    this.paintMaterial.uniforms.uFeather.value = this.feather
    ;(this.paintMaterial.uniforms.uSpot.value as THREE.Vector3).set(this.spot.at, this.spot.width, this.spot.gain)
    r.setRenderTarget(this.paintTarget)
    r.render(this.paintScene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
  }
}

const keep = new WeakMap<Engine, LogisticSource>()

/** the film's one diagram, shared by the scenes of Act II */
export function logisticSource(engine: Engine): LogisticSource {
  let s = keep.get(engine)
  if (!s) {
    s = new LogisticSource(engine.renderer, engine.size)
    keep.set(engine, s)
  }
  return s
}
