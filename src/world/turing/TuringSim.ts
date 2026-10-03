/**
 * GPU Gray–Scott on the sphere: the state (U, V) of every texel of a GRID_W × GRID_H
 * equirectangular grid in two float render targets, one Euler step per full-screen pass, the
 * targets swapped after each (ping-pong, so no pass ever samples the target it writes). The
 * scheme, the reduced grid and the pole handling are described in grid.ts; the passes are in
 * shaders.ts. `texture` always holds the latest state.
 *
 * Format: RG32F (8 bytes a texel, 4 MB a target) where the driver can render to it, else RGBA32F.
 * Float32 is required, as for the swarm: at half precision the per-step changes of U near 1
 * (≈ 1e-4) are below its resolution (≈ 5e-4) and the pattern would not evolve as computed.
 */
import * as THREE from 'three'
import { fullscreenVert } from '../../sim/shaders/fullscreen'
import { GRID_H, GRID_W, buildRows, rowTexels, seedSphere, type RowTable } from './grid'
import { buildStepFrag, copyFrag } from './shaders'

export class TuringSim {
  readonly rows: RowTable
  /** 1 × H float texture of the per-row coefficients; the coat shader reads it too */
  readonly rowTexture: THREE.DataTexture

  private readonly renderer: THREE.WebGLRenderer
  private read: THREE.WebGLRenderTarget
  private write: THREE.WebGLRenderTarget

  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly stepUniforms: {
    uState: THREE.IUniform<THREE.Texture | null>
    uRows: THREE.IUniform<THREE.Texture>
    uFeed: THREE.IUniform<number>
    uKill: THREE.IUniform<number>
  }
  private readonly copyUniforms = { uSource: { value: null as THREE.Texture | null } }
  private readonly stepMaterial: THREE.ShaderMaterial
  private readonly copyMaterial: THREE.ShaderMaterial

  /** the seeded initial state (identical every reset), built once on the first reset */
  private initial: THREE.DataTexture | null = null
  private readonly channels: number

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
      throw new Error('The Turing pattern simulation needs WebGL 2, which this browser or GPU does not provide.')
    }
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'The Turing pattern simulation needs the WebGL 2 extension EXT_color_buffer_float (rendering to 32-bit float textures), which this GPU or browser does not support.',
      )
    }
    this.renderer = renderer
    this.rows = buildRows(GRID_W, GRID_H)

    const rowData = rowTexels(this.rows)
    this.rowTexture = new THREE.DataTexture(rowData, 1, GRID_H, THREE.RGBAFormat, THREE.FloatType)
    this.rowTexture.minFilter = THREE.NearestFilter
    this.rowTexture.magFilter = THREE.NearestFilter
    this.rowTexture.generateMipmaps = false
    this.rowTexture.needsUpdate = true
    this.rowTexture.name = 'TuringSim.rows'

    this.stepUniforms = {
      uState: { value: null },
      uRows: { value: this.rowTexture },
      uFeed: { value: 0.037 },
      uKill: { value: 0.06 },
    }
    this.stepMaterial = passMaterial('TuringSim.step', buildStepFrag(this.rows), this.stepUniforms)
    this.copyMaterial = passMaterial('TuringSim.copy', copyFrag, this.copyUniforms)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    // RG32F if this driver can render to it, else RGBA32F
    let format: THREE.PixelFormat = THREE.RGFormat
    this.read = createTarget(format)
    this.write = createTarget(format)
    if (!this.complete(this.read)) {
      this.read.dispose()
      this.write.dispose()
      format = THREE.RGBAFormat
      this.read = createTarget(format)
      this.write = createTarget(format)
    }
    this.channels = format === THREE.RGFormat ? 2 : 4
    this.read.texture.name = 'TuringSim.stateA'
    this.write.texture.name = 'TuringSim.stateB'

    try {
      this.validate()
    } catch (e) {
      this.dispose()
      throw e
    }
  }

  /** Latest state: (U, V) in the first two channels, texel (s, t) ↔ (φ = 2πs, θ = πt). */
  get texture(): THREE.Texture {
    return this.read.texture
  }

  /** Advance `steps` Gray–Scott steps with feed `f` and kill `k`. */
  step(steps: number, f: number, k: number): void {
    if (steps <= 0 || this.disposed) return
    const u = this.stepUniforms
    u.uFeed.value = f
    u.uKill.value = k
    this.begin()
    for (let i = 0; i < steps; i++) {
      u.uState.value = this.read.texture
      this.pass(this.stepMaterial, this.write)
      this.swap()
    }
    this.end()
  }

  /** Back to the seeded initial state (uniform U ≈ 1, V ≈ 0, plus noise and the seed discs). */
  reset(): void {
    if (this.disposed) return
    const initial = this.initial ?? (this.initial = this.buildInitial())
    initial.needsUpdate = true
    this.copyUniforms.uSource.value = initial
    this.begin()
    this.pass(this.copyMaterial, this.read)
    this.pass(this.copyMaterial, this.write)
    this.end()
    // free the GPU copy; the array stays for the next reset
    initial.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.read.dispose()
    this.write.dispose()
    this.rowTexture.dispose()
    this.initial?.dispose()
    this.stepMaterial.dispose()
    this.copyMaterial.dispose()
    this.quad.geometry.dispose()
  }

  // ---------------------------------------------------------------------------------------

  private buildInitial(): THREE.DataTexture {
    const n = GRID_W * GRID_H
    const u = new Float32Array(n)
    const v = new Float32Array(n)
    seedSphere(u, v, this.rows)
    const c = this.channels
    const data = new Float32Array(n * c)
    for (let p = 0; p < n; p++) {
      data[p * c] = u[p]
      data[p * c + 1] = v[p]
    }
    const tex = new THREE.DataTexture(data, GRID_W, GRID_H, c === 2 ? THREE.RGFormat : THREE.RGBAFormat, THREE.FloatType)
    tex.minFilter = THREE.NearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.name = 'TuringSim.initial'
    return tex
  }

  private complete(target: THREE.WebGLRenderTarget): boolean {
    const gl = this.renderer.getContext()
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(target)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    this.renderer.setRenderTarget(prev)
    return ok
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

  /** Compile both programs and check the float framebuffer, so failures throw instead of drawing black. */
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
    this.begin()
    try {
      r.setRenderTarget(this.read)
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          `This GPU cannot render to 32-bit float textures (framebuffer status 0x${status.toString(16)}), which the Turing pattern simulation needs.`,
        )
      }
      // the copy pass from a 1-texel stand-in, then one step; reset() overwrites both targets
      const probe = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)
      probe.needsUpdate = true
      this.copyUniforms.uSource.value = probe
      for (const [material, target] of [
        [this.copyMaterial, this.read],
        [this.stepMaterial, this.write],
      ] as const) {
        this.stepUniforms.uState.value = this.read.texture
        this.pass(material, target)
        if (failure !== null) throw new Error(`${material.name} shader failed to compile.\n${failure}`)
      }
      probe.dispose()
      this.copyUniforms.uSource.value = null
    } finally {
      this.end()
      debug.checkShaderErrors = prevCheck
      debug.onShaderError = prevHook
    }
  }
}

function createTarget(format: THREE.PixelFormat): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(GRID_W, GRID_H, {
    type: THREE.FloatType,
    format,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping, // φ wraps
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  })
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
