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
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import type { Engine } from '../../engine/Engine'
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

  if (uForm < 0.5) {
    if (!(x > 0.0 && x < 1.0)) x = 0.05 + 0.9 * hash12(cell + uSeed);
    for (int i = 0; i < 12; i++) x = dial * x * (1.0 - x);
  } else {
    if (!(abs(x) < 2.0)) x = (hash12(cell + uSeed) - 0.5) * 0.5;
    for (int i = 0; i < 12; i++) x = x * x + dial;
  }

  float v = (x - uValue.x) / (uValue.y - uValue.x);
  // particles the reveal has not reached wait on its edge; particles outside the value range
  // are sent out of sight
  float shown = min(u, uReveal);
  float z = (hash12(cell + 7.1) - 0.5) * uDepth;
  if (v < 0.0 || v > 1.0) z = 1.0e5;
  gl_FragColor = vec4(shown, v, z, x);
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

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
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
      },
      depthTest: false,
      depthWrite: false,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
    // settle before the first frame is shown
    for (let i = 0; i < 40; i++) this.step()
  }

  get texture() {
    return this.read.texture
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
  }

  private step() {
    const r = this.renderer
    const u = this.material.uniforms
    u.uState.value = this.read.texture
    u.uReveal.value = this.reveal
    u.uForm.value = this.form === 'logistic' ? 0 : 1
    u.uDepth.value = this.depth
    u.uSeed.value = (this.frame++ % 977) + 0.5
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(this.write)
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
    const t = this.read
    this.read = this.write
    this.write = t
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
