/**
 * The chaos game as a dust source. Wraps the GPU collage (`IfsSim`): every step moves every
 * particle by one map of the preset, picked at random with the preset's odds, so the whole
 * cloud folds into shrunken copies of itself.
 *
 * The simulation keeps only the state before and after the last roll. A small resolve pass
 * places each particle part-way along its roll (turning as its map turns, see `chaosPointsVert`
 * in the old renderer), so slow rolls are seen as glides; the previous resolve is kept for
 * motion streaks. At high rates the particles are drawn where they landed, no in-between.
 *
 * Source space is the preset's stage units (frame centred on 0, larger half-extent 1), z = a
 * hair of depth jitter. Aux (w) is the tone of the map that placed the particle (0.12 … 0.96),
 * so a look with `tone: 'aux'` shades each copy by the move that made it.
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import { floatTarget } from '../../engine/sources'
import { IfsSim } from '../../fractal/ifs/IfsSim'
import { RESPAWN_BOUND } from '../../fractal/ifs/shaders'
import { MAP_COUNT_MAX, createIfsUniforms, presetUniforms, type IfsFrame } from '../../fractal/ifs/presets'
import type { IfsPreset } from '../../fractal/types'

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const resolveFrag = /* glsl */ `
#define MAP_COUNT_MAX ${MAP_COUNT_MAX}
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPhase;
uniform vec4 uMotion[2 * MAP_COUNT_MAX];
uniform float uDepth;
uniform float uSize;
varying vec2 vUv;

const float BOUND2 = ${(RESPAWN_BOUND * RESPAWN_BOUND).toFixed(1)};

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 turn(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec4 cur = texture2D(uCur, vUv);
  vec4 prv = texture2D(uPrev, vUv);
  if (!(dot(prv.xy, prv.xy) < BOUND2)) prv = cur;
  float t = uPhase;
  vec2 p = cur.xy;
  float tone = cur.w;
  if (t < 1.0) {
    vec4 m0 = vec4(0.0);
    vec4 m1 = vec4(1.0, 0.0, 1.0, 0.0);
    for (int i = 0; i < MAP_COUNT_MAX; i++) {
      if (abs(cur.z - float(i)) < 0.5) {
        m0 = uMotion[2 * i];
        m1 = uMotion[2 * i + 1];
      }
    }
    vec2 d = prv.xy - m0.xy;
    vec2 sd = vec2(m1.x * d.x + m1.y * d.y, m1.y * d.x + m1.z * d.y);
    vec2 path = m0.xy + turn(mix(d, sd, t), t * m0.z);
    vec2 end = m0.xy + turn(sd, m0.z);
    p = path + t * (cur.xy - end);
    tone = mix(prv.w, cur.w, t);
  }
  float z = (hash12(floor(gl_FragCoord.xy) + 3.7) - 0.5) * uDepth;
  gl_FragColor = vec4(p, z, tone);
}
`

/** at or above this many rolls a second the particles are drawn where they land */
const SNAP_RATE = 10
const EASE_FULL_RATE = 2
const EASE_LINEAR_RATE = 8
const MAX_STEPS_PER_FRAME = 4

export class IfsSource implements DustSource {
  /** stage units → world */
  readonly matrix = new THREE.Matrix4()
  readonly sim: IfsSim
  /** rolls per second (0 holds still) */
  rate = 0
  /** total rolls since the last scatter */
  rolls = 0

  private readonly renderer: THREE.WebGLRenderer
  private readonly maps = createIfsUniforms()
  private preset_: IfsPreset = 'sierpinski'
  private variation_ = 0
  private out: THREE.WebGLRenderTarget[]
  private outIndex = 0
  private carry = 0
  private snapped = false
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly motion = new Float32Array(8 * MAP_COUNT_MAX)
  private clock = 0
  private fresh = true

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.renderer = renderer
    this.sim = new IfsSim(renderer, size)
    this.out = [floatTarget(size), floatTarget(size)]
    for (let i = 0; i < MAP_COUNT_MAX; i++) {
      this.motion[i * 8 + 4] = 1
      this.motion[i * 8 + 6] = 1
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: resolveFrag,
      uniforms: {
        uCur: { value: null },
        uPrev: { value: null },
        uPhase: { value: 1 },
        uMotion: { value: this.motion },
        uDepth: { value: 0.006 },
        uSize: { value: size },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
    this.setPreset('sierpinski', 0)
  }

  get texture() {
    return this.out[this.outIndex].texture
  }

  /** last frame's picture while particles glide; none once they jump (no streaks across the shape) */
  get prevTexture() {
    return this.snapped || this.fresh ? null : this.out[1 - this.outIndex].texture
  }

  get preset(): IfsPreset {
    return this.preset_
  }

  get variation(): number {
    return this.variation_
  }

  /** swap the moves; the cloud folds into the new shape on the following rolls */
  setPreset(preset: IfsPreset, variation = this.variation_) {
    this.preset_ = preset
    this.variation_ = variation
    presetUniforms(preset, variation, this.maps)
    this.sim.setMaps(this.maps)
  }

  setVariation(v: number) {
    if (v === this.variation_) return
    this.setPreset(this.preset_, v)
  }

  /** every particle to a random place inside `frame` (stage units), and hold still */
  scatter(frame: IfsFrame) {
    this.sim.scatter(frame)
    this.carry = 0
    this.rolls = 0
    this.snapped = false
    this.fresh = true
    this.resolve(1)
    this.resolve(1)
  }

  /** stage-unit position of the preset's map fixed point i (corners of the triangle, tip of the fern) */
  fixedPoint(i: number): [number, number] {
    const m = this.maps.motion
    return [m[i * 8], m[i * 8 + 1]]
  }

  update(dt: number) {
    if (dt <= 0) return
    this.clock += dt
    const rate = Math.max(0, this.rate)
    if (rate > 0) {
      this.carry += rate * dt
      const owed = Math.floor(this.carry)
      if (owed > 0) {
        const steps = Math.min(owed, MAX_STEPS_PER_FRAME)
        for (let i = 0; i < steps; i++) this.sim.step(this.clock)
        this.rolls += owed
        this.carry -= owed
        this.motion.set(this.maps.motion)
        this.snapped = rate >= SNAP_RATE
        this.fresh = false
      }
    }
    let phase = 1
    if (!this.snapped) {
      const c = Math.min(Math.max(this.carry, 0), 1)
      const s = c * c * (3 - 2 * c)
      const linear = Math.min(Math.max((rate - EASE_FULL_RATE) / (EASE_LINEAR_RATE - EASE_FULL_RATE), 0), 1)
      phase = rate > 0 ? s + (c - s) * linear : 1
    }
    this.resolve(phase)
  }

  dispose() {
    this.sim.dispose()
    for (const t of this.out) t.dispose()
    this.material.dispose()
  }

  private resolve(phase: number) {
    const u = this.material.uniforms
    u.uCur.value = this.sim.texture
    u.uPrev.value = this.sim.previousTexture
    u.uPhase.value = phase
    this.outIndex = 1 - this.outIndex
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(this.out[this.outIndex])
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
  }
}
