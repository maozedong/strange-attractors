/**
 * A dust source computed on the graphics card by one fragment shader: every frame the shader is
 * run once per particle (one texel each) and writes vec4(xyz, aux). Two float targets alternate,
 * so the frame before is always at hand for motion streaks.
 *
 * Two kinds of shader fit:
 *  - closed form: position is a function of the particle and the clock (rings on Kepler orbits,
 *    points running round a loop). Read `uTime`, ignore `uState`.
 *  - stepped: the new state is computed from the old one (a flow). Read `uState`, which holds
 *    the previous frame's output.
 *
 * The shader sees `vUv` (the particle's texel centre), `uTime` (this source's own clock, which
 * only runs while the film does), `uDt` (the clock's last step, 0 when held still), `uState`,
 * and any uniforms passed in. Renderer state is saved and restored around the pass.
 */
import * as THREE from 'three'
import type { Dust, DustSource } from '../../engine/Dust'
import { Blit, floatTarget } from '../../engine/sources'

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export class FragmentSource implements DustSource {
  readonly matrix = new THREE.Matrix4()
  readonly uniforms: Record<string, THREE.IUniform>
  readonly size: number
  /** clock multiplier */
  rate = 1
  /** this source's clock */
  time = 0
  /** hold the picture (the shader is not run) */
  frozen = false
  /** called with the frame's step just before the shader runs (set per-frame uniforms here) */
  beforeRun: ((dt: number) => void) | null = null

  private readonly renderer: THREE.WebGLRenderer
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private index = 0
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly quad: THREE.Mesh
  private readonly blit = new Blit()
  private disposed = false

  constructor(renderer: THREE.WebGLRenderer, size: number, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}) {
    this.renderer = renderer
    this.size = size
    this.targets = [floatTarget(size), floatTarget(size)]
    this.uniforms = { ...uniforms, uTime: { value: 0 }, uDt: { value: 0 }, uState: { value: this.targets[1].texture } }
    this.material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  get texture(): THREE.Texture {
    return this.targets[this.index].texture
  }

  get prevTexture(): THREE.Texture {
    return this.targets[1 - this.index].texture
  }

  update(dt: number) {
    if (this.disposed) return
    if (this.frozen || dt <= 0) {
      // standing still: last frame = this frame, so nothing streaks
      this.blit.copy(this.renderer, this.texture, this.targets[1 - this.index])
      return
    }
    this.time += dt * this.rate
    this.beforeRun?.(dt * this.rate)
    this.run(dt * this.rate)
  }

  /** run the shader once now (after changing uniforms while nothing is advancing) */
  run(dt = 0) {
    if (this.disposed) return
    this.uniforms.uState.value = this.texture
    this.uniforms.uTime.value = this.time
    this.uniforms.uDt.value = dt
    this.index = 1 - this.index
    this.pass(this.material, this.targets[this.index])
  }

  /** copy a texture of the same size into both targets (state for a stepped shader) */
  load(texture: THREE.Texture) {
    if (this.disposed) return
    this.blit.copy(this.renderer, texture, this.targets[0])
    this.blit.copy(this.renderer, texture, this.targets[1])
  }

  /** run another full-screen program over the current state, in place (one extra pass) */
  apply(material: THREE.ShaderMaterial, stateUniform = 'uState') {
    if (this.disposed) return
    material.uniforms[stateUniform].value = this.texture
    const next = 1 - this.index
    this.pass(material, this.targets[next])
    this.index = next
    // keep last frame equal, so the rewrite does not streak
    this.blit.copy(this.renderer, this.texture, this.targets[1 - this.index])
  }

  /** a full-screen program for `apply`, sharing this source's vertex stage */
  program(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader, uniforms, depthTest: false, depthWrite: false })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.targets[0].dispose()
    this.targets[1].dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
    this.blit.dispose()
  }

  private pass(material: THREE.Material, target: THREE.WebGLRenderTarget) {
    const r = this.renderer
    const saved = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = false
    this.quad.material = material
    r.setRenderTarget(target)
    r.render(this.scene, this.camera)
    r.setRenderTarget(saved)
    r.autoClear = autoClear
    this.quad.material = this.material
  }
}

/**
 * Free a source the dust may still be reading. If it is still on screen, freeze the picture
 * first; if the next scene's flight may still be leaving from it, wait until it has landed.
 */
export function releaseSource(dust: Dust, src: DustSource, free: () => void) {
  if (dust.source === src) dust.setSource(dust.bake(), { ...dust.look })
  // the next scene's flight reads the old source until it lands (a few seconds at most)
  window.setTimeout(free, 6000)
}
