/**
 * The dust while the tap drips. Most particles lie as a faint sheet on the dark water, lit for a
 * moment where a ring passes under them. The rest are shared out among 48 marks: when a drop
 * lands, one mark's particles leap from the splash and settle as a small bright cluster in a
 * strip beside the tap, at a height set by that drip's gap. The strip slides left a step per
 * drip, so a steady rhythm draws a row, a split rhythm two rows, and chaos a scatter.
 *
 * Everything is computed on the GPU from a handful of uniforms (the marks, the ripples), so
 * nothing is uploaded per frame. Positions are in world space (the matrix is the identity).
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import { Blit, floatTarget } from '../../engine/sources'

export const MARKS = 48
export const RIPPLES = 8

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const frag = /* glsl */ `
uniform float uTime;
uniform float uMarkShare;
uniform vec4 uMark[${MARKS}];      // x, y (world), age (s; < 0 empty), brightness 0..1
uniform vec4 uRipple[${RIPPLES}];  // x, z, age (s; < 0 none), strength
uniform vec3 uImpact;              // where the drops land
uniform float uFloor;
uniform float uRise;               // seconds a mark takes to leap from the splash to its place
uniform float uSpread;             // radius of one mark
uniform float uRingLife;
uniform float uRingReach;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 water(vec2 cell, out float tone) {
  float a = hash12(cell + 1.7);
  float b = hash12(cell + 9.2);
  float c = hash12(cell + 4.4);
  float d = hash12(cell + 6.6);
  // a wide sheet, denser near the tap
  float r = 0.2 + 5.2 * pow(a, 0.85);
  float th = b * 6.2831853;
  vec3 p = vec3(uImpact.x - 0.6 + r * cos(th) * 1.25, uFloor + 0.006 + 0.05 * c * c * c, uImpact.z - 0.5 + r * sin(th) * 0.8);
  // a slow swell
  p.x += 0.03 * sin(uTime * 0.21 + d * 40.0);
  p.z += 0.03 * cos(uTime * 0.17 + c * 40.0);
  tone = 0.16 + 0.18 * d;
  // the rings light the water they pass through
  float lit = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 rp = uRipple[i];
    if (rp.z < 0.0 || rp.z > uRingLife) continue;
    float t = rp.z / uRingLife;
    float rad = 0.02 + uRingReach * (1.0 - pow(1.0 - t, 2.4));
    float dist = length(p.xz - rp.xy);
    float w = 0.012 + 0.04 * t;
    float e = (dist - rad) / w;
    lit += exp(-e * e) * (1.0 - t) * (1.0 - t) * rp.w;
    // a second, slower ring inside the first
    float rad2 = rad * 0.6;
    float e2 = (dist - rad2) / (w * 0.8);
    lit += 0.5 * exp(-e2 * e2) * (1.0 - t) * (1.0 - t) * (1.0 - t) * rp.w;
  }
  tone += 0.5 * min(lit, 1.2);
  p.y += 0.012 * min(lit, 1.0);
  return p;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float h = hash12(cell + 0.37);
  float tone;
  vec3 p = water(cell, tone);

  if (h < uMarkShare) {
    int slot = int(floor(h / uMarkShare * float(${MARKS})));
    vec4 m = vec4(0.0, 0.0, -1.0, 0.0);
    for (int i = 0; i < ${MARKS}; i++) if (i == slot) m = uMark[i];
    if (m.z >= 0.0) {
      // a soft ball: most particles near the middle
      float a = hash12(cell + 2.1);
      float b = hash12(cell + 5.3);
      float c = hash12(cell + 8.9);
      vec3 dir = normalize(vec3(a - 0.5, b - 0.5, c - 0.5) + 1e-4);
      float rad = uSpread * pow(hash12(cell + 3.7), 1.6);
      vec3 home = vec3(m.x, m.y, 0.0) + dir * rad;
      // each particle leaves the splash a little after the last: a short comet
      float lag = hash12(cell + 12.4) * 0.1;
      float k = clamp((m.z - lag * uRise) / uRise, 0.0, 1.0);
      float e = 1.0 - pow(1.0 - k, 3.0);
      vec3 from = uImpact + dir * rad * 0.4;
      vec3 q = mix(from, home, e);
      // a spray in flight, gathering as it arrives
      q += dir * (0.012 + 0.6 * rad) * sin(3.14159265 * e);
      // up and over, not straight across
      q.y += sin(3.14159265 * e) * 0.18;
      p = k > 0.0 ? q : from;
      tone = m.w * (0.62 + 0.3 * hash12(cell + 14.2)) + (1.0 - k) * 0.4;
      if (k <= 0.0) tone = 0.0;
    }
  }
  gl_FragColor = vec4(p, tone);
}
`

export class MarksSource implements DustSource {
  readonly matrix = new THREE.Matrix4()
  /** x, y, age, brightness for each mark slot */
  readonly marks = Array.from({ length: MARKS }, () => new THREE.Vector4(0, 0, -1, 0))
  /** x, z, age, strength for each ripple */
  readonly ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -1, 0))
  readonly impact = new THREE.Vector3()

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private readonly prev: THREE.WebGLRenderTarget
  private readonly blit = new Blit()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private time = 0

  constructor(renderer: THREE.WebGLRenderer, size: number, opts: { floor: number; rise: number; spread: number; share: number; ringLife: number; ringReach: number }) {
    this.renderer = renderer
    this.read = floatTarget(size)
    this.write = floatTarget(size)
    this.prev = floatTarget(size)
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uMarkShare: { value: opts.share },
        uMark: { value: this.marks },
        uRipple: { value: this.ripples },
        uImpact: { value: this.impact },
        uFloor: { value: opts.floor },
        uRise: { value: opts.rise },
        uSpread: { value: opts.spread },
        uRingLife: { value: opts.ringLife },
        uRingReach: { value: opts.ringReach },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
    this.render()
    this.blit.copy(renderer, this.read.texture, this.prev)
  }

  get texture() {
    return this.read.texture
  }

  get prevTexture() {
    return this.prev.texture
  }

  update(dt: number) {
    if (dt <= 0) return
    this.time += dt
    this.blit.copy(this.renderer, this.read.texture, this.prev)
    this.render()
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.prev.dispose()
    this.blit.dispose()
    this.material.dispose()
  }

  private render() {
    const r = this.renderer
    this.material.uniforms.uTime.value = this.time
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
