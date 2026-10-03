/**
 * GPU taffy: `size * size` passive points advected by the rods' flow (puller.ts), one midpoint
 * substep (midpointStep) per pass.
 *
 * Ping-pong (as IfsSim)
 *   State lives in two RGBA32F render targets, one texel per point: vec4(x, y, colour id, 0) in
 *   domain units. A step samples `read`, renders a full-screen quad into `write`, then the two
 *   swap. After the swap the old read target IS the previous state, so `previousTexture` costs
 *   nothing; it stays valid until the next step overwrites it. A reset writes both targets, so
 *   right after one, previous == current.
 *
 * The rods' kinematics run on the CPU in double precision (rodFrame) and reach the shader as
 * uniforms for the substep's start, midpoint and end.
 */
import * as THREE from 'three'
import { fullscreenVert } from '../../sim/shaders/fullscreen'
import { initFrag } from '../../sim/shaders/init'
import { describeShaderError } from '../../fractal/ifs/IfsSim'
import { ROD_STRIDE, freshTaffy } from './puller'
import { taffyStepFrag } from './shaders'

/** Respawn seeds wrap here, so the hash input stays small and precise. */
const SEED_PERIOD = 4096
/** Per-substep offset of the respawn hash seed (irrational, so substeps never share a seed). */
const STEP_SEED = 0.7548776662

export class TaffySim {
  readonly size: number
  readonly count: number

  /** vec2 per point: uv of its texel centre in `texture`. Bind as attribute `ref`. */
  readonly refAttribute: THREE.BufferAttribute
  /** vec3 zeros. Only there so three knows the draw count; bind as `position`. */
  readonly positionAttribute: THREE.BufferAttribute

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget

  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  private readonly stepUniforms = {
    uState: { value: null as THREE.Texture | null },
    uRodA: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    uRodB: { value: Array.from({ length: 6 }, () => new THREE.Vector2()) },
    uRodEnd: { value: Array.from({ length: 3 }, () => new THREE.Vector2(9, 9)) },
    uDt: { value: 0 },
    uSeed: { value: 0 },
  }
  private readonly initUniforms = {
    uSource: { value: null as THREE.Texture | null },
  }
  private readonly stepMaterial: THREE.ShaderMaterial
  private readonly initMaterial: THREE.ShaderMaterial

  /** fresh taffy, built once; its GPU copy is freed after each upload */
  private readonly uploadData: Float32Array
  private readonly upload: THREE.DataTexture
  private freshBuilt = false

  private serial = 0

  // renderer state saved around a batch of passes (fields, so no per-frame allocation)
  private savedTarget: THREE.WebGLRenderTarget | null = null
  private savedFace = 0
  private savedMip = 0
  private savedAutoClear = true
  private savedXr = false
  private savedShadowAuto = true

  private disposed = false

  /** @throws Error with a human-readable reason if the GPU cannot run the simulation */
  constructor(renderer: THREE.WebGLRenderer, size = 512) {
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error('The taffy puller needs WebGL 2, which this browser or GPU does not provide.')
    }
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'The taffy puller needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.',
      )
    }
    const maxSize = renderer.capabilities.maxTextureSize
    if (!Number.isInteger(size) || size < 1 || size > maxSize) {
      throw new Error(`TaffySim size must be an integer between 1 and ${maxSize}, got ${size}.`)
    }

    this.renderer = renderer
    this.size = size
    this.count = size * size

    const targetOptions: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.read = new THREE.WebGLRenderTarget(size, size, targetOptions)
    this.write = new THREE.WebGLRenderTarget(size, size, targetOptions)
    this.read.texture.name = 'TaffySim.stateA'
    this.write.texture.name = 'TaffySim.stateB'

    this.uploadData = new Float32Array(this.count * 4)
    this.upload = new THREE.DataTexture(this.uploadData, size, size, THREE.RGBAFormat, THREE.FloatType)
    this.upload.minFilter = THREE.NearestFilter
    this.upload.magFilter = THREE.NearestFilter
    this.upload.generateMipmaps = false

    this.stepMaterial = passMaterial('TaffySim.step', taffyStepFrag, this.stepUniforms)
    this.initMaterial = passMaterial('TaffySim.init', initFrag, this.initUniforms)

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.initMaterial)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    const ref = new Float32Array(this.count * 2)
    for (let i = 0; i < this.count; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size
    }
    this.refAttribute = new THREE.BufferAttribute(ref, 2)
    this.positionAttribute = new THREE.BufferAttribute(new Float32Array(this.count * 3), 3)

    try {
      this.validate()
    } catch (e) {
      this.dispose()
      throw e
    }
  }

  /** Current state: vec4(x, y, colour id, 0) per texel, domain units. */
  get texture(): THREE.Texture {
    return this.read.texture
  }

  /** The state one substep before `texture` (equal to it right after a reset). */
  get previousTexture(): THREE.Texture {
    return this.write.texture
  }

  /** Lay fresh taffy (the same every time) into both targets. */
  reset(): void {
    if (this.disposed) return
    if (!this.freshBuilt) {
      freshTaffy(this.count, this.uploadData)
      this.freshBuilt = true
    }
    this.upload.needsUpdate = true
    this.initUniforms.uSource.value = this.upload
    this.begin()
    this.pass(this.initMaterial, this.read)
    this.pass(this.initMaterial, this.write)
    this.end()
    // free the GPU copy; the next reset re-uploads from uploadData
    this.upload.dispose()
  }

  /**
   * One midpoint substep of `dt` pulls. `rods0` and `rodsMid` are rod frames (rodFrame) at the
   * substep's start and midpoint, `rodsEnd` at its end (only the centres are used).
   */
  step(rods0: Float64Array, rodsMid: Float64Array, rodsEnd: Float64Array, dt: number): void {
    if (this.disposed) return
    const u = this.stepUniforms
    for (let k = 0; k < 3; k++) {
      const o = k * ROD_STRIDE
      u.uRodA.value[k].set(rods0[o], rods0[o + 1], rods0[o + 2], rods0[o + 3])
      u.uRodB.value[k].set(rods0[o + 4], rods0[o + 5])
      u.uRodA.value[k + 3].set(rodsMid[o], rodsMid[o + 1], rodsMid[o + 2], rodsMid[o + 3])
      u.uRodB.value[k + 3].set(rodsMid[o + 4], rodsMid[o + 5])
      u.uRodEnd.value[k].set(rodsEnd[o], rodsEnd[o + 1])
    }
    u.uDt.value = dt
    u.uSeed.value = (this.serial % SEED_PERIOD) * STEP_SEED
    this.serial++
    u.uState.value = this.read.texture
    this.begin()
    this.pass(this.stepMaterial, this.write)
    this.swap()
    this.end()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.read.dispose()
    this.write.dispose()
    this.upload.dispose()
    this.stepMaterial.dispose()
    this.initMaterial.dispose()
    this.quad.geometry.dispose()
  }

  // ---------------------------------------------------------------------------------------

  private swap(): void {
    const t = this.read
    this.read = this.write
    this.write = t
  }

  /** Save the renderer state the passes touch. Pair with end(). */
  private begin(): void {
    const r = this.renderer
    this.savedTarget = r.getRenderTarget()
    this.savedFace = r.getActiveCubeFace()
    this.savedMip = r.getActiveMipmapLevel()
    this.savedAutoClear = r.autoClear
    this.savedXr = r.xr.enabled
    this.savedShadowAuto = r.shadowMap.autoUpdate
    r.autoClear = false // every pass overwrites every texel; clearing is wasted bandwidth
    r.xr.enabled = false // otherwise render() swaps our camera for the XR camera
    r.shadowMap.autoUpdate = false
  }

  private end(): void {
    const r = this.renderer
    r.setRenderTarget(this.savedTarget, this.savedFace, this.savedMip)
    r.autoClear = this.savedAutoClear
    r.xr.enabled = this.savedXr
    r.shadowMap.autoUpdate = this.savedShadowAuto
    this.savedTarget = null
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Run both programs once and check the float framebuffer, so a broken driver or a shader typo
   * becomes a thrown Error instead of a silent black screen. Leaves both targets zeroed.
   */
  private validate(): void {
    const r = this.renderer
    const gl = r.getContext() as WebGL2RenderingContext
    const debug = r.debug
    const prevCheck = debug.checkShaderErrors
    const prevHook = debug.onShaderError
    let failure: string | null = null
    debug.checkShaderErrors = true
    debug.onShaderError = (_gl, program, vs, fs) => {
      failure = describeShaderError(gl, program, vs, fs)
    }

    const run = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => {
      this.pass(material, target)
      if (failure !== null) throw new Error(`${material.name} shader failed to compile.\n${failure}`)
    }

    this.begin()
    try {
      r.setRenderTarget(this.read)
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          `This GPU cannot render to 32-bit float textures (framebuffer status 0x${status.toString(16)}), which the taffy puller needs.`,
        )
      }
      this.upload.needsUpdate = true
      this.initUniforms.uSource.value = this.upload // zeros
      run(this.initMaterial, this.read)
      this.stepUniforms.uState.value = this.read.texture
      run(this.stepMaterial, this.write)
      run(this.initMaterial, this.write)
    } finally {
      this.end()
      debug.checkShaderErrors = prevCheck
      debug.onShaderError = prevHook
      this.upload.dispose()
    }
  }
}

function passMaterial(
  name: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    vertexShader: fullscreenVert,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
}
