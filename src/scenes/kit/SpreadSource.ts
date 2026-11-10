/**
 * A dust source that spreads a small CPU state over every particle. The CPU keeps a few
 * thousand things (birds, fireflies, the cells of a sand grid) in a small texture; a fragment
 * shader, run once per particle, places each particle on its thing, so a frame uploads
 * kilobytes instead of a quarter of a million positions.
 *
 * The shader writes vec4(xyz in source space, aux) for particle
 * `particleIndex() = floor(gl_FragCoord.y) * uSize + floor(gl_FragCoord.x)`, the order the dust
 * reads its texture in. `uSize`, `uCount` (= uSize²) and `uTime` are provided, and
 * `hashI(index, salt)` gives a fixed random number per particle. With `motion` on, the previous
 * frame's result is kept as `prevTexture`, so moving particles streak.
 */
import * as THREE from 'three'
import type { DustSource } from '../../engine/Dust'
import { floatTarget } from '../../engine/sources'

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const header = /* glsl */ `
uniform float uSize;
uniform float uCount;
uniform float uTime;
varying vec2 vUv;
float particleIndex() {
  return floor(gl_FragCoord.y) * uSize + floor(gl_FragCoord.x);
}
float hashI(float i, float salt) {
  vec3 p3 = fract(vec3(i * 0.1031 + salt * 0.37, i * 0.1030 + salt * 0.71, i * 0.0973 + salt * 0.13));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

export class SpreadSource implements DustSource {
  readonly matrix = new THREE.Matrix4()
  readonly uniforms: Record<string, THREE.IUniform>
  private readonly material: THREE.ShaderMaterial
  private readonly renderer: THREE.WebGLRenderer
  private readonly targets: THREE.WebGLRenderTarget[]
  private readonly motion: boolean
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh
  private index = 0
  private rendered = false

  constructor(renderer: THREE.WebGLRenderer, size: number, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, motion = false) {
    this.renderer = renderer
    this.motion = motion
    this.targets = motion ? [floatTarget(size), floatTarget(size)] : [floatTarget(size)]
    this.uniforms = { ...uniforms, uSize: { value: size }, uCount: { value: size * size }, uTime: { value: 0 } }
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: header + fragmentShader,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  get texture(): THREE.Texture {
    return this.targets[this.index].texture
  }

  get prevTexture(): THREE.Texture | null {
    return this.motion ? this.targets[1 - this.index].texture : null
  }

  /**
   * Run the shader into the next target; the one written last frame becomes `prevTexture`.
   * The scene calls this once per frame (so it also runs while the scene is leaving and the
   * dust is flying away from it).
   */
  render(time: number) {
    this.uniforms.uTime.value = time
    if (this.motion) this.index = 1 - this.index
    this.draw(this.targets[this.index])
    // first frame, or after a jump: both targets hold the same picture, so nothing streaks
    if (!this.rendered && this.motion) this.draw(this.targets[1 - this.index])
    this.rendered = true
  }

  /** the next render writes the same picture to both targets (after a jump, so nothing streaks) */
  still() {
    this.rendered = false
  }

  dispose() {
    for (const t of this.targets) t.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }

  private draw(target: THREE.WebGLRenderTarget) {
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    r.setRenderTarget(target)
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
  }
}

/** a float RGBA data texture, nearest-sampled, for the CPU's half of a SpreadSource */
export function dataTexture(width: number, height: number, data?: Float32Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data ?? new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}
