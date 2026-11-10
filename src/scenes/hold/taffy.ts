/**
 * The taffy puller as a dust source. TaffySim (the old GPU simulation) keeps one texel per
 * point: (x, y, colour id) in its own domain, advanced in midpoint substeps by the three rods'
 * exactly incompressible flow. Substeps come slower than frames at a gentle pull, so each frame
 * the shown positions are blended between the last two substeps (a point that respawned jumps)
 * into a target of our own; the frame before is kept for motion streaks.
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import { rampColor, type Palette } from '../../engine/palettes'
import { TaffySim } from '../../world/taffy/TaffySim'
import { ROD_FRAME, ROD_STRIDE, SUBSTEPS_PER_PULL, freshTaffy, rodFrame, rodKinematics } from '../../world/taffy/puller'
import { FragmentSource } from '../kit/FragmentSource'

/** substeps one frame may run; a backlog beyond is dropped */
const MAX_STEPS_PER_FRAME = 10

const blendFrag = /* glsl */ `
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uCur, vUv);
  vec4 p = texture2D(uPrev, vUv);
  vec2 d = c.xy - p.xy;
  vec2 xy = dot(d, d) < 0.25 ? mix(p.xy, c.xy, uPhase) : c.xy;
  // the two colours sit a hair apart in depth, so neither always paints over the other
  gl_FragColor = vec4(xy, (c.z - 0.5) * 0.004, c.z);
}
`

export class TaffySource implements DustSource {
  readonly sim: TaffySim
  /** pulls per second */
  speed = 0
  /** pulls shown so far (fractional) */
  pulls = 0
  /** rod centres at the shown time, domain units: x0 y0 x1 y1 x2 y2 */
  readonly rods = new Float64Array(6)
  /** per-particle colour: the two inks */
  readonly paint: THREE.DataTexture

  private readonly out: FragmentSource
  private substeps = 0
  private carry = 0
  private readonly f0 = new Float64Array(ROD_FRAME)
  private readonly fm = new Float64Array(ROD_FRAME)
  private readonly f1 = new Float64Array(ROD_FRAME)
  private readonly shown = new Float64Array(ROD_FRAME)
  private readonly ids: Float32Array

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.sim = new TaffySim(renderer, size)
    this.out = new FragmentSource(renderer, size, blendFrag, {
      uCur: { value: this.sim.texture },
      uPrev: { value: this.sim.previousTexture },
      uPhase: { value: 1 },
    })
    this.ids = new Float32Array(size * size * 4)
    freshTaffy(size * size, this.ids)
    this.paint = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType)
    this.paint.minFilter = THREE.NearestFilter
    this.paint.magFilter = THREE.NearestFilter
    this.reset()
  }

  get matrix() {
    return this.out.matrix
  }

  get texture() {
    return this.out.texture
  }

  get prevTexture() {
    return this.out.prevTexture
  }

  /** two inks from the act's ramp, a cool one (brightened: the cold end is dark) and a warm one */
  inks(palette: Palette) {
    const cool = rampColor(palette, 0.3).multiplyScalar(2.2)
    const warm = rampColor(palette, 0.8)
    const d = this.paint.image.data as Float32Array
    for (let i = 0; i < d.length; i += 4) {
      const c = this.ids[i + 2] < 0.5 ? warm : cool
      d[i] = c.r
      d[i + 1] = c.g
      d[i + 2] = c.b
      d[i + 3] = 1
    }
    this.paint.needsUpdate = true
  }

  /** fresh taffy, every point back where it started */
  reset() {
    this.sim.reset()
    this.substeps = 0
    this.carry = 0
    this.pulls = 0
    this.publish(1)
    this.out.run()
    this.out.run()
  }

  update(dt: number) {
    if (dt <= 0) {
      this.out.update(0)
      return
    }
    const rate = this.speed * SUBSTEPS_PER_PULL
    if (rate > 0) {
      this.carry += rate * Math.min(dt, 0.1)
      const owed = Math.floor(this.carry)
      if (owed > 0) {
        const steps = Math.min(owed, MAX_STEPS_PER_FRAME)
        for (let i = 0; i < steps; i++) {
          const n = this.substeps
          rodFrame(n / SUBSTEPS_PER_PULL, this.f0)
          rodFrame((n + 0.5) / SUBSTEPS_PER_PULL, this.fm)
          rodFrame((n + 1) / SUBSTEPS_PER_PULL, this.f1)
          this.sim.step(this.f0, this.fm, this.f1, 1 / SUBSTEPS_PER_PULL)
          this.substeps = n + 1
        }
        this.carry -= owed
      }
    }
    const phase = this.substeps > 0 ? Math.min(Math.max(this.carry, 0), 1) : 1
    this.publish(phase)
    this.out.update(dt)
  }

  dispose() {
    this.sim.dispose()
    this.out.dispose()
    this.paint.dispose()
  }

  private publish(phase: number) {
    const u = this.out.uniforms
    u.uCur.value = this.sim.texture
    u.uPrev.value = this.sim.previousTexture
    u.uPhase.value = phase
    this.pulls = this.substeps > 0 ? (this.substeps - 1 + phase) / SUBSTEPS_PER_PULL : 0
    rodKinematics(this.pulls, this.shown)
    for (let k = 0; k < 3; k++) {
      this.rods[k * 2] = this.shown[k * ROD_STRIDE]
      this.rods[k * 2 + 1] = this.shown[k * ROD_STRIDE + 1]
    }
  }
}
