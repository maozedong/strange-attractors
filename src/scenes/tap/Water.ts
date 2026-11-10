/**
 * The tap without a tap: a small point of light where the drops gather, the drops themselves
 * (and their reflections, rising to meet them in the black water), and thin rings spreading
 * where they land. Unlit, additive, coloured from the act's ramp.
 */
import * as THREE from 'three'
import { rampColor, type Palette } from '../../engine/palettes'
import { RIPPLES } from './MarksSource'

export const MAX_DROPS = 8

const spriteVert = /* glsl */ `
attribute float aSize;
attribute float aStretch;
attribute float aGlow;
uniform float uViewportH;
varying float vStretch;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * aStretch * projectionMatrix[1][1] * 0.5 * uViewportH / max(gl_Position.w, 1e-6);
  gl_PointSize = aSize > 0.0 ? max(px, 3.0) : 0.0;
  vStretch = aStretch;
  vGlow = aGlow;
}
`

const spriteFrag = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uOpacity;
varying float vStretch;
varying float vGlow;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.x *= vStretch;
  float d2 = dot(p, p);
  if (d2 > 1.0 || vGlow <= 0.0) discard;
  float core = 1.0 - smoothstep(0.004, 0.022, d2);
  float halo = exp(-7.0 * d2) * (1.0 - d2) * 0.6 + exp(-40.0 * d2) * 0.5;
  gl_FragColor = vec4((uCore * core + uHalo * halo) * vGlow * uOpacity, 1.0);
}
`

const ringVert = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const ringFrag = /* glsl */ `
uniform vec4 uRipple[${RIPPLES}];
uniform vec3 uInk;
uniform vec3 uGlow;
uniform float uLife;
uniform float uReach;
uniform float uOpacity;
varying vec2 vP;

float ring(float d, float r, float w) {
  float t = (d - r) / w;
  return exp(-t * t);
}

void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 rp = uRipple[i];
    if (rp.z < 0.0 || rp.z > uLife) continue;
    float t = rp.z / uLife;
    float d = length(vP - rp.xy);
    float rad = 0.02 + uReach * (1.0 - pow(1.0 - t, 2.4));
    float w = 0.0035 + 0.012 * t;
    float fade = (1.0 - t) * (1.0 - t);
    float rings = ring(d, rad, w) + 0.55 * ring(d, rad * 0.6, w * 0.8) * (1.0 - t);
    // the splash: a flash at the centre in the first instant
    float flash = exp(-d * d / 0.0008) * max(0.0, 1.0 - rp.z / 0.16);
    col += (uGlow * rings * fade * 0.5 + uInk * flash) * rp.w;
  }
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
`

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
} as const

export class Water {
  readonly object = new THREE.Group()
  opacity = 0
  private readonly sprites: THREE.Points
  private readonly spriteMaterial: THREE.ShaderMaterial
  private readonly geometry = new THREE.BufferGeometry()
  private readonly pos: THREE.BufferAttribute
  private readonly size: THREE.BufferAttribute
  private readonly stretch: THREE.BufferAttribute
  private readonly glow: THREE.BufferAttribute
  private readonly plane: THREE.Mesh
  private readonly ringMaterial: THREE.ShaderMaterial
  /** sprite count: the gathering drop, falling drops, and each one's reflection */
  private readonly n = (1 + MAX_DROPS) * 2

  constructor(palette: Palette, ripples: THREE.Vector4[], floorY: number, ringLife: number, ringReach: number) {
    this.pos = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.size = new THREE.BufferAttribute(new Float32Array(this.n), 1).setUsage(THREE.DynamicDrawUsage)
    this.stretch = new THREE.BufferAttribute(new Float32Array(this.n).fill(1), 1).setUsage(THREE.DynamicDrawUsage)
    this.glow = new THREE.BufferAttribute(new Float32Array(this.n), 1).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('position', this.pos)
    this.geometry.setAttribute('aSize', this.size)
    this.geometry.setAttribute('aStretch', this.stretch)
    this.geometry.setAttribute('aGlow', this.glow)
    this.spriteMaterial = new THREE.ShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      uniforms: {
        uViewportH: { value: 800 },
        uCore: { value: rampColor(palette, 0.97).multiplyScalar(2.4) },
        uHalo: { value: rampColor(palette, 0.6).multiplyScalar(1.1) },
        uOpacity: { value: 0 },
      },
      ...additive,
      depthTest: true,
    })
    this.sprites = new THREE.Points(this.geometry, this.spriteMaterial)
    this.sprites.frustumCulled = false
    this.sprites.renderOrder = 12
    this.object.add(this.sprites)

    this.ringMaterial = new THREE.ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: {
        uRipple: { value: ripples },
        uInk: { value: rampColor(palette, 0.95).multiplyScalar(1.6) },
        uGlow: { value: rampColor(palette, 0.62).multiplyScalar(1.5) },
        uLife: { value: ringLife },
        uReach: { value: ringReach },
        uOpacity: { value: 0 },
      },
      ...additive,
      depthTest: true,
    })
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), this.ringMaterial)
    this.plane.position.y = floorY + 0.002
    this.plane.renderOrder = 11
    this.object.add(this.plane)
  }

  /** put the plane under the splashes */
  centre(x: number, z: number) {
    this.plane.position.x = x
    this.plane.position.z = z
  }

  /**
   * Write one sprite. Index 0 is the gathering drop, 1..MAX_DROPS the falling ones; each is
   * mirrored in the floor automatically.
   */
  sprite(i: number, x: number, y: number, z: number, size: number, stretch: number, glow: number, floorY: number) {
    const a = this.pos.array as Float32Array
    const s = this.size.array as Float32Array
    const st = this.stretch.array as Float32Array
    const g = this.glow.array as Float32Array
    const m = i + 1 + MAX_DROPS
    a[i * 3] = x
    a[i * 3 + 1] = y
    a[i * 3 + 2] = z
    s[i] = size
    st[i] = stretch
    g[i] = glow
    // the reflection, dimmer and softer the higher the drop is above the water
    const h = Math.max(0, y - floorY)
    a[m * 3] = x
    a[m * 3 + 1] = 2 * floorY - y
    a[m * 3 + 2] = z
    s[m] = size * (1 + 0.6 * h)
    st[m] = stretch
    g[m] = glow * 0.42 * Math.exp(-1.1 * h)
  }

  commit(viewportH: number) {
    this.pos.needsUpdate = true
    this.size.needsUpdate = true
    this.stretch.needsUpdate = true
    this.glow.needsUpdate = true
    this.spriteMaterial.uniforms.uViewportH.value = viewportH
    this.spriteMaterial.uniforms.uOpacity.value = this.opacity
    this.ringMaterial.uniforms.uOpacity.value = this.opacity
    this.object.visible = this.opacity > 0.001
  }

  dispose() {
    this.geometry.dispose()
    this.spriteMaterial.dispose()
    this.plane.geometry.dispose()
    this.ringMaterial.dispose()
  }
}
