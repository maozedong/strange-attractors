/**
 * GPU particle swarm: `size * size` particles integrated with RK4 in a fragment shader.
 *
 * Ping-pong
 *   Particle state lives in two RGBA32F render targets, one texel per particle:
 *   texel = vec4(x, y, z, speed) in system units, speed = |dp/dt| at the start of the last
 *   step. A pass samples `read` and renders a full-screen quad into `write`, then the two
 *   swap. A texture is never sampled while it is being rendered to, so each pass sees one
 *   consistent snapshot. `texture` always returns the latest state.
 *
 * Respawn
 *   After each step a particle whose new position is non-finite or farther than
 *   `bound(P)` from `frame(P).center` is replaced by a random point in a small ball
 *   (0.02 render units) around `seed(P)`, a point on the attractor. Particles therefore
 *   never get lost or turn into NaN, and a parameter change that makes the system blow up
 *   just recycles them onto the new shape.
 *
 * One shader serves every system. The step program is built once from the whole catalog
 * and branches on `uniform int uSystem`, so switching systems costs nothing but a uniform.
 */
import * as THREE from 'three'
import type { AttractorSystem, Frame, Vec3 } from '../types'
import { SYSTEMS } from '../systems'
import { sampleTrajectory, speedAt } from './cpu'
import { tele } from './telemetry'
import { fullscreenVert } from './shaders/fullscreen'
import { initFrag } from './shaders/init'
import { remapFrag } from './shaders/remap'
import { MAX_PARAMS, buildStepFrag } from './shaders/step'

/** Seed of the cloud PRNG: every cloud spawn is identical, so replays look the same. */
const CLOUD_SEED = 0x5eed1e55
/** Respawn ball radius in render units (converted to system units per system). */
const RESPAWN_RADIUS = 0.02
/** Per-substep offset of the respawn hash seed (irrational, so substeps never repeat). */
const SUBSTEP_SEED = 0.7548776662
/** Respawn seeds wrap at this many seconds to keep the hash input small and precise. */
const SEED_WRAP = 1000

export class SwarmSim {
  readonly size: number
  readonly count: number

  /** vec2 per particle: uv of its texel centre in `texture`. Bind as attribute `ref`. */
  readonly refAttribute: THREE.BufferAttribute
  /** float per particle in 0..1, rewritten by every spawn. Bind as attribute `aHue`. */
  readonly hueAttribute: THREE.BufferAttribute
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
    uSystem: { value: 0 },
    P: { value: new Float32Array(MAX_PARAMS) },
    uDt: { value: 0 },
    uTime: { value: 0 },
    uSeedCenter: { value: new THREE.Vector3() },
    uSeedRadius: { value: 0 },
    uBoundCenter: { value: new THREE.Vector3() },
    // large but finite so uBound * uBound stays a finite float32 before setSystem is called
    uBound: { value: 1e18 },
  }
  private readonly initUniforms = {
    uSource: { value: null as THREE.Texture | null },
  }
  private readonly remapUniforms = {
    uState: { value: null as THREE.Texture | null },
    uFromCenter: { value: new THREE.Vector3() },
    uFromScale: { value: 1 },
    uToCenter: { value: new THREE.Vector3() },
    uToScale: { value: 1 },
  }
  private readonly stepMaterial: THREE.ShaderMaterial
  private readonly initMaterial: THREE.ShaderMaterial
  private readonly remapMaterial: THREE.ShaderMaterial

  /** CPU staging for spawns. The array is kept; its GPU copy is freed after each upload. */
  private readonly uploadData: Float32Array
  private readonly upload: THREE.DataTexture
  /** scratch for speedAt so spawns do not allocate per particle */
  private readonly scratch = new Float64Array(3)

  /** system/params last given to setSystem/setParams (used for spawn speeds) */
  private sys: AttractorSystem | null = null
  private params: number[] = []

  // renderer state saved around a batch of passes (fields, so no per-frame allocation)
  private savedTarget: THREE.WebGLRenderTarget | null = null
  private savedFace = 0
  private savedMip = 0
  private savedAutoClear = true
  private savedXr = false
  private savedShadowAuto = true

  private disposed = false
  /** true once this instance has published its count to telemetry */
  private publishedCount = false

  /** @throws Error with a human-readable reason if the GPU cannot run the simulation */
  constructor(renderer: THREE.WebGLRenderer, size: number) {
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error('The particle simulation needs WebGL 2, which this browser or GPU does not provide.')
    }
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'The particle simulation needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.',
      )
    }
    const maxSize = renderer.capabilities.maxTextureSize
    if (!Number.isInteger(size) || size < 1 || size > maxSize) {
      throw new Error(`SwarmSim size must be an integer between 1 and ${maxSize}, got ${size}.`)
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
    this.read.texture.name = 'SwarmSim.stateA'
    this.write.texture.name = 'SwarmSim.stateB'

    this.uploadData = new Float32Array(this.count * 4)
    this.upload = new THREE.DataTexture(this.uploadData, size, size, THREE.RGBAFormat, THREE.FloatType)
    this.upload.minFilter = THREE.NearestFilter
    this.upload.magFilter = THREE.NearestFilter
    this.upload.generateMipmaps = false

    this.stepMaterial = passMaterial('SwarmSim.step', buildStepFrag(SYSTEMS), this.stepUniforms)
    this.initMaterial = passMaterial('SwarmSim.init', initFrag, this.initUniforms)
    this.remapMaterial = passMaterial('SwarmSim.remap', remapFrag, this.remapUniforms)

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.initMaterial)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    // per-particle attributes
    const ref = new Float32Array(this.count * 2)
    for (let i = 0; i < this.count; i++) {
      ref[i * 2] = ((i % size) + 0.5) / size
      ref[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size
    }
    this.refAttribute = new THREE.BufferAttribute(ref, 2)
    this.hueAttribute = new THREE.BufferAttribute(new Float32Array(this.count), 1)
    this.positionAttribute = new THREE.BufferAttribute(new Float32Array(this.count * 3), 3)

    try {
      this.validate()
    } catch (e) {
      this.dispose()
      throw e
    }

    tele.particleCount = this.count
    this.publishedCount = true
  }

  /** Latest particle state: vec4(x, y, z, speed) per texel, system units. */
  get texture(): THREE.Texture {
    return this.read.texture
  }

  /** Select the system by catalog index (must match SYSTEMS[index]) and apply its params. */
  setSystem(index: number, sys: AttractorSystem, P: number[]): void {
    if (SYSTEMS[index] !== sys) {
      throw new Error(`SwarmSim.setSystem: index ${index} is not '${sys.id}' in the SYSTEMS catalog.`)
    }
    this.stepUniforms.uSystem.value = index
    this.setParams(sys, P)
  }

  /** Update params and everything derived from them (seed ball, escape bound). */
  setParams(sys: AttractorSystem, P: number[]): void {
    if (P.length > MAX_PARAMS) {
      throw new Error(`SwarmSim: '${sys.id}' has ${P.length} params; the shader supports ${MAX_PARAMS}.`)
    }
    this.sys = sys
    this.params = P.slice()

    const u = this.stepUniforms
    const packed = u.P.value
    packed.fill(0)
    for (let i = 0; i < P.length; i++) packed[i] = P[i]

    const frame = sys.frame(P)
    u.uSeedCenter.value.fromArray(sys.seed(P))
    u.uSeedRadius.value = RESPAWN_RADIUS / frame.scale
    u.uBoundCenter.value.fromArray(frame.center)
    u.uBound.value = sys.bound(P)
  }

  /** Advance every particle by `steps` RK4 steps of size `dt`. `time` (seconds) seeds respawns. */
  step(dt: number, steps: number, time: number): void {
    if (steps <= 0 || this.disposed) return
    const u = this.stepUniforms
    u.uDt.value = dt
    const seed = time % SEED_WRAP
    this.begin()
    for (let i = 0; i < steps; i++) {
      u.uState.value = this.read.texture
      u.uTime.value = seed + i * SUBSTEP_SEED
      this.pass(this.stepMaterial, this.write)
      this.swap()
    }
    this.end()
  }

  /**
   * Recompute the speed channel for the current positions and params without moving
   * anything (a zero-length step). Use it while paused after a param or system change so
   * speed colours are right before the next real step. Out-of-bound particles respawn.
   */
  refreshSpeed(): void {
    this.step(0, 1, 0)
  }

  /**
   * Fill a ball with particles, uniform by volume, from a fixed-seed PRNG (identical every
   * call). Hue is a smooth gradient over the ball: the angle around its z axis blended
   * 50/50 with height.
   */
  spawnCloud(center: Vec3, radius: number): void {
    const data = this.uploadData
    const hue = this.hueAttribute.array as Float32Array
    const p = this.scratch
    const { sys, params } = this
    const rand = mulberry32(CLOUD_SEED)
    const [cx, cy, cz] = center

    for (let i = 0; i < this.count; i++) {
      // inverse-CDF sampling of the ball: cos(theta) and phi uniform, r ~ cbrt(u)
      const cosT = 2 * rand() - 1
      const phi = 2 * Math.PI * rand()
      const rr = Math.cbrt(rand())
      const sinT = Math.sqrt(1 - cosT * cosT)
      const r = radius * rr
      p[0] = cx + r * sinT * Math.cos(phi)
      p[1] = cy + r * sinT * Math.sin(phi)
      p[2] = cz + r * cosT

      const o = i * 4
      data[o] = p[0]
      data[o + 1] = p[1]
      data[o + 2] = p[2]
      data[o + 3] = sys ? speedAt(sys, p, params) : 0

      // Angle around z goes through (1 - cos phi) / 2: 0 at +x, 1 at -x, continuous all the
      // way round. A linear phi / 2pi map would put a hard colour seam on the -x half-plane.
      const around = 0.5 - 0.5 * Math.cos(phi)
      const height = 0.5 + 0.5 * rr * cosT // normalised z in 0..1
      hue[i] = 0.5 * around + 0.5 * height
    }

    this.hueAttribute.needsUpdate = true
    this.uploadToBoth()
  }

  /**
   * Lay the particles along one long trajectory so the swarm starts as the finished
   * attractor. Synchronous: about 50 ms of JS for 262k particles.
   */
  spawnAttractor(sys: AttractorSystem, P: number[]): void {
    const n = this.count
    const pts = sampleTrajectory(sys, P, sys.seed(P), n, { stride: 1, transient: 2000 })
    const data = this.uploadData
    const hue = this.hueAttribute.array as Float32Array
    const p = this.scratch

    for (let i = 0; i < n; i++) {
      p[0] = pts[i * 3]
      p[1] = pts[i * 3 + 1]
      p[2] = pts[i * 3 + 2]
      const o = i * 4
      data[o] = p[0]
      data[o + 1] = p[1]
      data[o + 2] = p[2]
      data[o + 3] = speedAt(sys, p, P)
      hue[i] = i / n
    }

    this.hueAttribute.needsUpdate = true
    this.uploadToBoth()
  }

  /** Re-express every particle in another frame so nothing moves on screen (one pass). */
  remap(from: Frame, to: Frame): void {
    if (this.disposed) return
    const u = this.remapUniforms
    u.uFromCenter.value.fromArray(from.center)
    u.uFromScale.value = from.scale
    u.uToCenter.value.fromArray(to.center)
    u.uToScale.value = to.scale
    u.uState.value = this.read.texture
    this.begin()
    this.pass(this.remapMaterial, this.write)
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
    this.remapMaterial.dispose()
    this.quad.geometry.dispose()
    if (this.publishedCount && tele.particleCount === this.count) tele.particleCount = 0
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
    // free the GPU copy; the next spawn re-uploads from uploadData
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
   * Run every program once and check the float framebuffer, so a broken driver or a typo
   * in any catalog system's `glsl` becomes a thrown Error instead of a silent black
   * screen. Leaves both targets zeroed.
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
      if (failure === null) return
      const hint =
        material === this.stepMaterial
          ? ' The excerpt names the system; check its `glsl` in src/systems.'
          : ''
      throw new Error(`${material.name} shader failed to compile.${hint}\n${failure}`)
    }

    this.begin()
    try {
      r.setRenderTarget(this.read)
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          `This GPU cannot render to 32-bit float textures (framebuffer status 0x${status.toString(16)}), which the particle simulation needs.`,
        )
      }
      this.upload.needsUpdate = true
      this.initUniforms.uSource.value = this.upload // zeros
      run(this.initMaterial, this.read)
      this.remapUniforms.uState.value = this.read.texture
      run(this.remapMaterial, this.write)
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
  const m = new THREE.ShaderMaterial({
    name,
    vertexShader: fullscreenVert,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
  return m
}

/** Info logs plus a source excerpt around the first reported error line. */
function describeShaderError(
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
