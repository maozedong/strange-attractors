/**
 * GPU Lenia on a LENIA_GRID² torus, the house ping-pong pattern (see src/sim/SwarmSim.ts).
 *
 * Targets
 *   read / write   RGBA32F, R = A in [0, 1], NearestFilter + RepeatWrapping. A step samples
 *                  `read` and renders into `write`, then they swap, so after a step `write`
 *                  holds the previous generation (the display blends the two).
 *   look           RGBA16F, the displayed field (previous → current blend), LinearFilter so
 *                  the plane gets hardware bilinear filtering (float32 is not filterable on
 *                  every GPU; half float always is on WebGL 2).
 *   halo           HALO_GRID² RGBA16F, a blur of `look` for the glow.
 *   tele           TELE_GRID² RGBA32F block sums / maxima, read back asynchronously.
 *
 * The kernel is a KERNEL_DIAMETER² R32F DataTexture refilled on a species change.
 */
import * as THREE from 'three'
import { fullscreenVert } from '../../sim/shaders/fullscreen'
import { KERNEL_DIAMETER, SEED_LAYOUT, buildKernel, countBlobs, stampPattern } from './core'
import type { LeniaSpecies } from './species'
import { HALO_GRID, LENIA_GRID, TELE_GRID, copyFrag, haloFrag, lookFrag, reduceFrag, stepFrag } from './shaders'

/** Threshold on a telemetry block's mean A for it to count as part of a creature. */
export const BLOB_THRESHOLD = 0.1
const BLOCK_CELLS = (LENIA_GRID / TELE_GRID) ** 2

export interface LeniaStats {
  mass: number
  blobs: number
}

export class LeniaSim {
  readonly N = LENIA_GRID

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget
  private readonly look: THREE.WebGLRenderTarget
  private readonly halo: THREE.WebGLRenderTarget
  private readonly tele: THREE.WebGLRenderTarget

  private readonly kernelData = new Float32Array(KERNEL_DIAMETER * KERNEL_DIAMETER)
  private readonly kernel: THREE.DataTexture
  private readonly uploadData = new Float32Array(LENIA_GRID * LENIA_GRID)
  private readonly upload: THREE.DataTexture

  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  private readonly stepUniforms = {
    uState: { value: null as THREE.Texture | null },
    uKernel: { value: null as THREE.Texture | null },
    uM: { value: 0.15 },
    uS: { value: 0.015 },
    uDt: { value: 0.1 },
  }
  private readonly copyUniforms = { uSrc: { value: null as THREE.Texture | null } }
  private readonly reduceUniforms = { uState: { value: null as THREE.Texture | null } }
  private readonly lookUniforms = {
    uPrev: { value: null as THREE.Texture | null },
    uCur: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
  }
  private readonly haloUniforms = { uLook: { value: null as THREE.Texture | null } }
  private readonly stepMaterial: THREE.ShaderMaterial
  private readonly copyMaterial: THREE.ShaderMaterial
  private readonly reduceMaterial: THREE.ShaderMaterial
  private readonly lookMaterial: THREE.ShaderMaterial
  private readonly haloMaterial: THREE.ShaderMaterial

  // telemetry readback: one request in flight at a time, into a reused buffer
  private readonly teleData = new Float32Array(TELE_GRID * TELE_GRID * 4)
  private readonly labels = new Int32Array(TELE_GRID * TELE_GRID)
  private readonly queue = new Int32Array(TELE_GRID * TELE_GRID)
  private inFlight = false
  /** the field changed since the last readback was issued (or that readback failed) */
  private statsDirty = false
  /** bumped by load(); a readback issued before it is stale */
  private epoch = 0
  private readonly onRead = (epoch: number) => {
    // a read superseded by load() must not touch inFlight: load() already cleared it
    if (epoch !== this.epoch) return
    this.inFlight = false
    if (this.disposed) return
    this.finishStats()
  }
  private readonly onReadFailed = (epoch: number) => {
    if (epoch !== this.epoch) return
    this.inFlight = false
    this.statsDirty = true // try again with the next sample
  }
  /** latest telemetry (updated when a readback lands) */
  readonly stats: LeniaStats = { mass: 0, blobs: 0 }

  // renderer state saved around a batch of passes (fields, so no per-frame allocation)
  private savedTarget: THREE.WebGLRenderTarget | null = null
  private savedFace = 0
  private savedMip = 0
  private savedAutoClear = true
  private savedXr = false
  private savedShadowAuto = true

  private disposed = false

  /** @throws Error with a human-readable reason if the GPU cannot run the simulation */
  constructor(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error('Lenia needs WebGL 2, which this browser or GPU does not provide.')
    }
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'Lenia needs the WebGL 2 extension EXT_color_buffer_float (rendering to float textures), which this GPU or browser does not support.',
      )
    }
    this.renderer = renderer
    const N = LENIA_GRID

    const target = (size: number, type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter, name: string) => {
      const t = new THREE.WebGLRenderTarget(size, size, {
        type,
        format: THREE.RGBAFormat,
        minFilter: filter,
        magFilter: filter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        generateMipmaps: false,
        depthBuffer: false,
        stencilBuffer: false,
      })
      t.texture.name = name
      return t
    }
    this.read = target(N, THREE.FloatType, THREE.NearestFilter, 'Lenia.stateA')
    this.write = target(N, THREE.FloatType, THREE.NearestFilter, 'Lenia.stateB')
    this.look = target(N, THREE.HalfFloatType, THREE.LinearFilter, 'Lenia.look')
    this.halo = target(HALO_GRID, THREE.HalfFloatType, THREE.LinearFilter, 'Lenia.halo')
    this.tele = target(TELE_GRID, THREE.FloatType, THREE.NearestFilter, 'Lenia.tele')

    this.kernel = new THREE.DataTexture(this.kernelData, KERNEL_DIAMETER, KERNEL_DIAMETER, THREE.RedFormat, THREE.FloatType)
    this.kernel.name = 'Lenia.kernel'
    this.upload = new THREE.DataTexture(this.uploadData, N, N, THREE.RedFormat, THREE.FloatType)
    this.upload.name = 'Lenia.seed'
    for (const t of [this.kernel, this.upload]) {
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.generateMipmaps = false
      t.flipY = false
    }
    this.stepUniforms.uKernel.value = this.kernel

    this.stepMaterial = passMaterial('Lenia.step', stepFrag, this.stepUniforms)
    this.copyMaterial = passMaterial('Lenia.copy', copyFrag, this.copyUniforms)
    this.reduceMaterial = passMaterial('Lenia.reduce', reduceFrag, this.reduceUniforms)
    this.lookMaterial = passMaterial('Lenia.look', lookFrag, this.lookUniforms)
    this.haloMaterial = passMaterial('Lenia.halo', haloFrag, this.haloUniforms)

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    try {
      this.validate()
    } catch (e) {
      this.dispose()
      throw e
    }
  }

  /** The displayed field (R), linear filtered, periodic. Valid after present(). */
  get lookTexture(): THREE.Texture {
    return this.look.texture
  }

  /** Blurred field (R) for the glow. Valid after present(). */
  get haloTexture(): THREE.Texture {
    return this.halo.texture
  }

  /** Current generation's state (R = A). Exposed for tests. */
  get stateTarget(): THREE.WebGLRenderTarget {
    return this.read
  }

  /** Rule and kernel of `species` (does not touch the field). */
  setSpecies(species: LeniaSpecies): void {
    buildKernel(species, this.kernelData)
    this.kernel.needsUpdate = true
    const u = this.stepUniforms
    u.uM.value = species.m
    u.uS.value = species.s
    u.uDt.value = 1 / species.T
  }

  /** Clear the dish and place `species` at the SEED_LAYOUT spots; both targets get it. */
  seed(species: LeniaSpecies): void {
    const N = LENIA_GRID
    const data = this.uploadData
    data.fill(0)
    for (const spot of SEED_LAYOUT) stampPattern(data, N, species.cells, spot.x * N, spot.y * N, spot.turns)
    this.load(data)
  }

  /** Replace the field with `field` (N² values, row-major, row 0 = bottom) in both targets. */
  load(field: Float32Array): void {
    if (this.disposed) return
    if (field !== this.uploadData) this.uploadData.set(field)
    // abandon any readback in flight (a lost context never settles its promise)
    this.epoch++
    this.inFlight = false
    this.kernel.needsUpdate = true // cheap, and covers a restored context
    this.upload.needsUpdate = true
    this.copyUniforms.uSrc.value = this.upload
    this.begin()
    try {
      this.pass(this.copyMaterial, this.read)
      this.pass(this.copyMaterial, this.write)
    } finally {
      this.end()
      // free the GPU copy; the next seed re-uploads from uploadData
      this.upload.dispose()
    }
    // telemetry of the new field right away, from the CPU copy (no stale numbers after a reset)
    this.statsFromField(this.uploadData)
    this.statsDirty = false
  }

  /** Advance `n` generations. */
  step(n: number): void {
    if (n <= 0 || this.disposed) return
    this.begin()
    try {
      for (let i = 0; i < n; i++) {
        this.stepUniforms.uState.value = this.read.texture
        this.pass(this.stepMaterial, this.write)
        const t = this.read
        this.read = this.write
        this.write = t
      }
    } finally {
      this.end()
    }
    this.statsDirty = true
  }

  /** Rebuild the display textures: previous generation blended toward the current by `mix`. */
  present(mix: number): void {
    if (this.disposed) return
    const u = this.lookUniforms
    u.uPrev.value = this.write.texture
    u.uCur.value = this.read.texture
    u.uMix.value = Math.min(1, Math.max(0, mix))
    this.haloUniforms.uLook.value = this.look.texture
    this.begin()
    try {
      this.pass(this.lookMaterial, this.look)
      this.pass(this.haloMaterial, this.halo)
    } finally {
      this.end()
    }
  }

  /**
   * Start a telemetry readback of the current generation if the field changed since the last
   * one and none is in flight. Results land in `stats` a frame or two later (a failed read
   * is retried by the next call). Returns false if nothing was started.
   */
  sampleStats(): boolean {
    if (this.disposed || this.inFlight || !this.statsDirty) return false
    if ((this.renderer.getContext() as WebGL2RenderingContext).isContextLost()) return false
    this.reduce()
    this.inFlight = true
    this.statsDirty = false
    const epoch = this.epoch
    this.renderer.readRenderTargetPixelsAsync(this.tele, 0, 0, TELE_GRID, TELE_GRID, this.teleData).then(
      () => this.onRead(epoch),
      () => this.onReadFailed(epoch),
    )
    return true
  }

  /**
   * Synchronous variant for tests: stalls the GPU pipeline. Returns the last stats unchanged
   * when disposed or while an asynchronous read is in flight (it shares the buffer).
   */
  sampleStatsSync(): LeniaStats {
    if (this.disposed || this.inFlight) return this.stats
    this.reduce()
    this.renderer.readRenderTargetPixels(this.tele, 0, 0, TELE_GRID, TELE_GRID, this.teleData)
    this.finishStats()
    this.statsDirty = false
    return this.stats
  }

  /** Copy of the current generation (N², row-major, row 0 = bottom). For tests: stalls. */
  readField(out: Float32Array, scratch: Float32Array): Float32Array {
    const N = LENIA_GRID
    if (this.disposed) return out
    this.renderer.readRenderTargetPixels(this.read, 0, 0, N, N, scratch)
    for (let i = 0; i < N * N; i++) out[i] = scratch[i * 4]
    return out
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.read.dispose()
    this.write.dispose()
    this.look.dispose()
    this.halo.dispose()
    this.tele.dispose()
    this.kernel.dispose()
    this.upload.dispose()
    this.stepMaterial.dispose()
    this.copyMaterial.dispose()
    this.reduceMaterial.dispose()
    this.lookMaterial.dispose()
    this.haloMaterial.dispose()
    this.quad.geometry.dispose()
  }

  // ---------------------------------------------------------------------------------------

  /** Same block sums the reduce pass makes, from a CPU field (N², row-major). */
  private statsFromField(field: Float32Array): void {
    const N = LENIA_GRID
    const shift = Math.log2(N / TELE_GRID)
    const d = this.teleData
    d.fill(0)
    for (let y = 0; y < N; y++) {
      const row = (y >> shift) * TELE_GRID
      for (let x = 0; x < N; x++) d[(row + (x >> shift)) * 4] += field[y * N + x]
    }
    this.finishStats()
  }

  private reduce(): void {
    this.reduceUniforms.uState.value = this.read.texture
    this.begin()
    try {
      this.pass(this.reduceMaterial, this.tele)
    } finally {
      this.end()
    }
  }

  private finishStats(): void {
    const d = this.teleData
    let mass = 0
    for (let i = 0; i < TELE_GRID * TELE_GRID; i++) mass += d[i * 4]
    this.stats.mass = mass
    this.stats.blobs = countBlobs(d, TELE_GRID, BLOB_THRESHOLD * BLOCK_CELLS, this.labels, this.queue, 4, 0)
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
    r.autoClear = false // every pass overwrites every texel
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
   * Run every program once and check the float framebuffers, so a broken driver or a shader
   * typo becomes a thrown Error instead of a silent black dish. Leaves the state zeroed.
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
    const complete = (target: THREE.WebGLRenderTarget, what: string) => {
      r.setRenderTarget(target)
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`This GPU cannot render to ${what} textures (framebuffer status 0x${status.toString(16)}), which Lenia needs.`)
      }
    }

    this.begin()
    try {
      complete(this.read, '32-bit float')
      complete(this.look, 'half-float')
      this.upload.needsUpdate = true
      this.copyUniforms.uSrc.value = this.upload // zeros
      run(this.copyMaterial, this.read)
      run(this.copyMaterial, this.write)
      this.stepUniforms.uState.value = this.read.texture
      run(this.stepMaterial, this.write)
      run(this.copyMaterial, this.write)
      this.lookUniforms.uPrev.value = this.write.texture
      this.lookUniforms.uCur.value = this.read.texture
      run(this.lookMaterial, this.look)
      this.haloUniforms.uLook.value = this.look.texture
      run(this.haloMaterial, this.halo)
      this.reduceUniforms.uState.value = this.read.texture
      run(this.reduceMaterial, this.tele)
    } finally {
      this.end()
      debug.checkShaderErrors = prevCheck
      debug.onShaderError = prevHook
      this.upload.dispose()
    }
  }
}

function passMaterial(name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
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
function describeShaderError(gl: WebGL2RenderingContext, program: WebGLProgram, vs: WebGLShader, fs: WebGLShader): string {
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
      for (let i = Math.max(0, n - 5); i < Math.min(lines.length, n + 2); i++) parts.push(`${i + 1 === n ? '>' : ' '} ${i + 1}: ${lines[i]}`)
    }
  }
  return parts.join('\n').replace(/\0/g, '')
}
