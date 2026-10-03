/**
 * GPU chaos game: `size * size` points, and every step moves each one by one affine map picked
 * at random with the preset's probabilities (the "collage" form of the chaos game: the whole
 * cloud is mapped at once, so it visibly folds into shrunken copies of itself).
 *
 * Ping-pong (as SwarmSim)
 *   State lives in two RGBA32F render targets, one texel per point:
 *   texel = vec4(x, y, map, tone): position in stage units (see presets.ts), index of the map
 *   that placed the point (−1 after a scatter or a respawn), and the palette t of that map's
 *   colour. A step samples `read`, renders a full-screen quad into `write`, then the two swap.
 *   After the swap the old read target IS the previous state, so `previousTexture` costs
 *   nothing; it stays valid until the next step overwrites it. A scatter writes both targets,
 *   so right after one, previous == current.
 *
 * Respawn
 *   A point whose new position is non-finite or more than `RESPAWN_BOUND` stage units from the
 *   preset frame's centre is put back at a uniform random point of that frame (map −1). For a
 *   system of contractions this never fires; it is there so a bad map can never fill the cloud
 *   with NaN.
 */
import * as THREE from 'three'
import { fullscreenVert } from '../../sim/shaders/fullscreen'
import { initFrag } from '../../sim/shaders/init'
import { MAP_COUNT_MAX, type IfsFrame, type IfsUniforms } from './presets'
import { RESPAWN_BOUND, SCATTER_TONE, ifsStepFrag } from './shaders'

export { RESPAWN_BOUND, SCATTER_TONE }

/** Seed of the scatter PRNG: every scatter is identical, so a replayed chapter looks the same. */
const SCATTER_SEED = 0x1f5c4a05
/** Step seeds wrap at this many seconds, so the hash input stays small and precise. */
const SEED_WRAP = 1000
/** Per-step offset of the hash seed (irrational, so successive steps never share a seed). */
const STEP_SEED = 0.7548776662
const STEP_SEED_PERIOD = 4096


export class IfsSim {
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
    uRows: { value: new Float32Array(6 * MAP_COUNT_MAX) },
    uCum: { value: new Float32Array(MAP_COUNT_MAX).fill(1) },
    uTones: { value: new Float32Array(MAP_COUNT_MAX).fill(SCATTER_TONE) },
    uCount: { value: 1 },
    uSeed: { value: 0 },
    uSpawn: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBound: { value: RESPAWN_BOUND },
  }
  private readonly initUniforms = {
    uSource: { value: null as THREE.Texture | null },
  }
  private readonly stepMaterial: THREE.ShaderMaterial
  private readonly initMaterial: THREE.ShaderMaterial

  /** CPU staging for scatters. The array is kept; its GPU copy is freed after each upload. */
  private readonly uploadData: Float32Array
  private readonly upload: THREE.DataTexture

  /** steps run so far; decorrelates the hash seed of steps run within one frame */
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
      throw new Error('The chaos game needs WebGL 2, which this browser or GPU does not provide.')
    }
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'The chaos game needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.',
      )
    }
    const maxSize = renderer.capabilities.maxTextureSize
    if (!Number.isInteger(size) || size < 1 || size > maxSize) {
      throw new Error(`IfsSim size must be an integer between 1 and ${maxSize}, got ${size}.`)
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
    this.read.texture.name = 'IfsSim.stateA'
    this.write.texture.name = 'IfsSim.stateB'

    this.uploadData = new Float32Array(this.count * 4)
    this.upload = new THREE.DataTexture(this.uploadData, size, size, THREE.RGBAFormat, THREE.FloatType)
    this.upload.minFilter = THREE.NearestFilter
    this.upload.magFilter = THREE.NearestFilter
    this.upload.generateMipmaps = false

    this.stepMaterial = passMaterial('IfsSim.step', ifsStepFrag, this.stepUniforms)
    this.initMaterial = passMaterial('IfsSim.init', initFrag, this.initUniforms)

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

  /** Current state: vec4(x, y, map, tone) per texel, stage units. */
  get texture(): THREE.Texture {
    return this.read.texture
  }

  /** The state one step before `texture` (equal to it right after a scatter). */
  get previousTexture(): THREE.Texture {
    return this.write.texture
  }

  /** Load a preset's maps (see presetUniforms). The arrays are copied; `u` may be reused. */
  setMaps(u: IfsUniforms): void {
    const s = this.stepUniforms
    s.uRows.value.set(u.maps)
    s.uCum.value.set(u.cumulative)
    s.uTones.value.set(u.tones)
    s.uCount.value = Math.max(1, Math.min(MAP_COUNT_MAX, u.count))
    s.uSpawn.value.set(u.frame.cx, u.frame.cy, u.frame.halfW, u.frame.halfH)
  }

  /** One iteration: every point is moved by one map picked at random. `time` (s) seeds the dice. */
  step(time: number): void {
    if (this.disposed) return
    const u = this.stepUniforms
    const t = Number.isFinite(time) ? Math.abs(time) % SEED_WRAP : 0
    u.uSeed.value = t + (this.serial % STEP_SEED_PERIOD) * STEP_SEED
    this.serial++
    u.uState.value = this.read.texture
    this.begin()
    this.pass(this.stepMaterial, this.write)
    this.swap()
    this.end()
  }

  /**
   * Scatter every point uniformly over `frame` (stage units) from a fixed-seed PRNG, identical
   * every call, into both targets. Map index −1, tone SCATTER_TONE.
   */
  scatter(frame: IfsFrame): void {
    const data = this.uploadData
    const rand = mulberry32(SCATTER_SEED)
    const { cx, cy, halfW, halfH } = frame
    for (let i = 0; i < this.count; i++) {
      const o = i * 4
      data[o] = cx + (2 * rand() - 1) * halfW
      data[o + 1] = cy + (2 * rand() - 1) * halfH
      data[o + 2] = -1
      data[o + 3] = SCATTER_TONE
    }
    this.uploadToBoth()
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

  private uploadToBoth(): void {
    if (this.disposed) return
    this.upload.needsUpdate = true
    this.initUniforms.uSource.value = this.upload
    this.begin()
    this.pass(this.initMaterial, this.read)
    this.pass(this.initMaterial, this.write)
    this.end()
    // free the GPU copy; the next scatter re-uploads from uploadData
    this.upload.dispose()
  }

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
          `This GPU cannot render to 32-bit float textures (framebuffer status 0x${status.toString(16)}), which the chaos game needs.`,
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

/** Info logs plus a source excerpt around the first reported error line. */
export function describeShaderError(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vs: WebGLShader,
  fs: WebGLShader,
): string {
  const parts: string[] = []
  const programLog = gl.getProgramInfoLog(program)?.trim()
  if (programLog) parts.push(`program: ${programLog}`)
  for (const [label, shader] of [
    ['vertex', vs],
    ['fragment', fs],
  ] as const) {
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) continue
    const log = gl.getShaderInfoLog(shader)?.trim() ?? ''
    parts.push(`${label}: ${log}`)
    const line = /ERROR:\s*\d+:(\d+)/.exec(log)
    const source = gl.getShaderSource(shader)
    if (line && source) {
      const n = Number(line[1])
      const lines = source.split('\n')
      const from = Math.max(0, n - 5)
      const to = Math.min(lines.length, n + 2)
      for (let i = from; i < to; i++) parts.push(`${i + 1 === n ? '>' : ' '} ${i + 1}: ${lines[i]}`)
    }
  }
  // some drivers NUL-terminate their info logs
  return parts.join('\n').replace(/\0/g, '')
}

/** Small, fast, seedable PRNG (Tommy Ettinger's mulberry32). Returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
