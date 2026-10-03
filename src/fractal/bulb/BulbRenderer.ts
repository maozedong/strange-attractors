import * as THREE from 'three'
import { bulbBound, bulbDE, MAX_BOUND, trapRange } from './de'
import { ResolutionGovernor } from './governor'
import { bulbVert, displayFrag, marchFrag } from './shaders'

/**
 * Everything the Mandelbulb needs to draw itself: the ray-march pass into an offscreen target
 * at an adaptive resolution, and the material that puts the result on the visible mesh with
 * depth. The component owns one and calls prepare() from useFrame and render() from the mesh's
 * onBeforeRender, so the march always uses the camera the scene is being drawn with (including
 * the rig's view offset). The scene must be drawn with one camera per frame.
 *
 * The march is skipped while nothing changes (camera still to within a third of a pixel, power
 * settled): the last result is displayed again for the cost of four texture fetches a pixel.
 * After SETTLE_S at rest it is redrawn once at a higher resolution if the budget allows.
 */

/** Rasterised sphere slack: its flat faces sit inside the true sphere by up to ~0.5%. */
const MESH_SLACK = 1.02
/** A march-to-march camera change below this many pixels is "still". */
const MOVE_PX = 0.33
/** Seconds at rest before the sharper redraw. */
const SETTLE_S = 0.25
/** Light directions in view space (x right, y up, z toward the viewer), pointing at the light. */
const KEY_VIEW = new THREE.Vector3(-0.55, 0.6, 0.62).normalize()
const RIM_VIEW = new THREE.Vector3(0.8, -0.2, -0.35).normalize()
const UP_VIEW = new THREE.Vector3(0, 1, 0)
/** Allocation granularity, growth headroom, and the area fraction below which the target shrinks. */
const QUANTUM = 64
const GROW_HEADROOM = 1.1
const SHRINK_AREA = 0.45

/** Debug counters, for the console. */
export const bulbStats = { marches: 0, scale: 0, texels: 0, budget: 0 }

// scratch, shared (single-threaded, never held across calls)
const bufferSize = new THREE.Vector2()
const inverseWorld = new THREE.Matrix4()
const camWorld = new THREE.Vector3()
const savedClear = new THREE.Color()
const trapScratch: [number, number] = [0, 0]
const basis = new THREE.Vector3()

export class BulbRenderer {
  /** unit sphere; the vertex shader scales it to the current bound */
  readonly geometry: THREE.SphereGeometry
  /** material of the visible mesh */
  readonly material: THREE.ShaderMaterial
  readonly governor = new ResolutionGovernor()

  private readonly marchMaterial: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly proxyCamera = new THREE.Camera()
  private readonly proxy: THREE.Mesh
  private target: THREE.WebGLRenderTarget | null = null
  private allocW = 0
  private allocH = 0

  private readonly shared = {
    uPower: { value: 8 },
    uBound: { value: bulbBound(8) },
    uMeshRadius: { value: bulbBound(8) * MESH_SLACK },
    uCamLocal: { value: new THREE.Vector3() },
  }
  private readonly marchUniforms = {
    ...this.shared,
    uPixelAngle: { value: 1e-3 },
    uKeyDir: { value: new THREE.Vector3() },
    uRimDir: { value: new THREE.Vector3() },
    uUpDir: { value: new THREE.Vector3() },
    uTrapRange: { value: new THREE.Vector2(0.729, 1.089) },
  }
  private readonly displayUniforms = {
    ...this.shared,
    uMarch: { value: null as THREE.Texture | null },
    uAlloc: { value: new THREE.Vector2(1, 1) },
    uMarchSize: { value: new THREE.Vector2(1, 1) },
    uFrame: { value: new THREE.Vector2(1, 1) },
  }

  // this frame, from prepare()
  private frameId = 0
  private drawnFrame = -1
  private delta = 0

  // the state of the last march
  private valid = false
  private drawnScale = 0
  private drawnW = 0
  private drawnH = 0
  private drawnPower = NaN
  private readonly drawnCam = new THREE.Vector3()
  private readonly drawnBasis = new Float64Array(9)
  private readonly drawnProjection = new Float64Array(16)
  private readonly drawnModel = new THREE.Matrix4()
  private stillTime = 0
  /** pixels and footprint of a march made while moving last frame (0 = none): the next interval measures it */
  private pendingPixels = 0
  private pendingArea = 0

  constructor() {
    this.geometry = new THREE.SphereGeometry(1, 48, 24)
    // conservative culling: the vertex shader grows the sphere up to the largest bound
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), MAX_BOUND * MESH_SLACK)
    this.marchMaterial = new THREE.ShaderMaterial({
      name: 'Mandelbulb.march',
      vertexShader: bulbVert,
      fragmentShader: marchFrag,
      uniforms: this.marchUniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    })
    this.material = new THREE.ShaderMaterial({
      name: 'Mandelbulb.display',
      vertexShader: bulbVert,
      fragmentShader: displayFrag,
      uniforms: this.displayUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
    })
    this.proxy = new THREE.Mesh(this.geometry, this.marchMaterial)
    this.proxy.frustumCulled = false
    this.proxy.matrixAutoUpdate = false
    this.proxy.matrixWorldAutoUpdate = false
    this.proxyCamera.matrixAutoUpdate = false
    this.proxyCamera.matrixWorldAutoUpdate = false
    this.scene.matrixWorldAutoUpdate = false
    this.scene.add(this.proxy)
  }

  /** Why this renderer cannot draw the bulb, or null if it can. */
  static unsupported(renderer: THREE.WebGLRenderer): string | null {
    const ext = renderer.extensions
    if (!ext.has('EXT_color_buffer_float') && !ext.has('EXT_color_buffer_half_float')) {
      return 'The Mandelbulb needs to render into half-float textures (EXT_color_buffer_float).'
    }
    return null
  }

  /**
   * Compile both programs without stalling the page (KHR_parallel_shader_compile where
   * available). Resolves when the first draw will not block on compilation.
   */
  compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Promise<unknown> {
    const scene = new THREE.Scene()
    const display = new THREE.Mesh(this.geometry, this.material)
    scene.add(this.proxy.clone(), display)
    // programs depend on the target's colour space: compile for an offscreen (linear) target,
    // which is what both passes draw into (the effect composer's buffer, and the march target)
    const probe = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(probe)
    const done = renderer.compileAsync(scene, camera)
    renderer.setRenderTarget(prev)
    return done.finally(() => probe.dispose())
  }

  /** GPU contents were lost (context restore): march again on the next frame. */
  invalidate(): void {
    this.valid = false
  }

  /**
   * Once per frame from useFrame. No allocations.
   * @param power the (tweened) exponent
   * @param delta seconds since the last frame
   * @param intervalMs performance.now() milliseconds since the last frame
   */
  prepare(power: number, delta: number, intervalMs: number, maxScale: number): void {
    this.frameId++
    this.delta = delta
    const g = this.governor
    g.maxScale = maxScale
    if (this.pendingPixels > 0) {
      g.sample(intervalMs, this.pendingPixels, this.pendingArea)
      this.pendingPixels = 0
    } else {
      g.reset()
    }
    const bound = bulbBound(power)
    this.shared.uPower.value = power
    this.shared.uBound.value = bound
    this.shared.uMeshRadius.value = bound * MESH_SLACK
    trapRange(power, trapScratch)
    this.marchUniforms.uTrapRange.value.set(trapScratch[0], trapScratch[1])
  }

  /** From the visible mesh's onBeforeRender: march if needed and point the display at the result. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, mesh: THREE.Object3D): void {
    if (this.drawnFrame === this.frameId) return
    this.drawnFrame = this.frameId

    const rt = renderer.getRenderTarget()
    if (rt) bufferSize.set(rt.width, rt.height)
    else renderer.getDrawingBufferSize(bufferSize)
    const W = bufferSize.x
    const H = bufferSize.y
    if (W < 1 || H < 1) return
    this.displayUniforms.uFrame.value.set(W, H)

    // camera and lights in the mesh's local (fractal) space
    inverseWorld.copy(mesh.matrixWorld).invert()
    camWorld.setFromMatrixPosition(camera.matrixWorld)
    const camLocal = this.shared.uCamLocal.value.copy(camWorld).applyMatrix4(inverseWorld)
    const mu = this.marchUniforms
    mu.uKeyDir.value.copy(KEY_VIEW).transformDirection(camera.matrixWorld).transformDirection(inverseWorld)
    mu.uRimDir.value.copy(RIM_VIEW).transformDirection(camera.matrixWorld).transformDirection(inverseWorld)
    mu.uUpDir.value.copy(UP_VIEW).transformDirection(camera.matrixWorld).transformDirection(inverseWorld)

    // the bound's footprint on screen, framebuffer pixels: what the march costs at scale 1
    const p = camera.projectionMatrix.elements
    const focalPx = (p[5] * H) / 2
    const meshScale = basis.setFromMatrixColumn(mesh.matrixWorld, 0).length()
    const R = this.shared.uBound.value * meshScale
    const dist = camWorld.distanceTo(basis.setFromMatrixPosition(mesh.matrixWorld))
    let area = W * H
    if (dist > R * 1.0001) {
      const rPx = (R / Math.sqrt(dist * dist - R * R)) * focalPx
      area = Math.min(area, Math.PI * rPx * rPx)
    }

    const moved = this.moved(camera, mesh, camLocal, focalPx, W, H)
    if (moved) this.stillTime = 0
    else this.stillTime += this.delta

    const g = this.governor
    let scale = 0
    if (moved || !this.valid) {
      scale = g.scaleFor(area)
    } else if (this.stillTime >= SETTLE_S) {
      const rest = g.restScaleFor(area)
      if (this.drawnScale < rest * 0.97) scale = rest
    }
    if (scale > 0) {
      this.ensureTarget(Math.ceil(W * scale), Math.ceil(H * scale), W, H)
      this.march(renderer, camera, mesh, W, H, scale, focalPx)
      // a march made in motion is measured by the next frame interval
      if (moved) {
        this.pendingPixels = scale * scale * area
        this.pendingArea = area
      }
      bulbStats.marches++
      bulbStats.scale = scale
      bulbStats.budget = g.budget
    }
  }

  dispose(): void {
    this.target?.dispose()
    this.target = null
    this.marchMaterial.dispose()
    this.material.dispose()
    this.geometry.dispose()
  }

  /** Has anything that the picture depends on changed by more than MOVE_PX since the last march? */
  private moved(camera: THREE.Camera, mesh: THREE.Object3D, camLocal: THREE.Vector3, focalPx: number, W: number, H: number): boolean {
    if (!this.valid || W !== this.drawnW || H !== this.drawnH) return true
    if (this.shared.uPower.value !== this.drawnPower) return true
    if (!mesh.matrixWorld.equals(this.drawnModel)) return true
    // turning: change of the camera's axes (radians, near enough) times the focal length
    const m = camera.matrixWorld.elements
    const b = this.drawnBasis
    let turn = 0
    for (let c = 0; c < 3; c++) {
      basis.set(m[4 * c], m[4 * c + 1], m[4 * c + 2]).normalize()
      turn = Math.max(turn, Math.abs(basis.x - b[3 * c]), Math.abs(basis.y - b[3 * c + 1]), Math.abs(basis.z - b[3 * c + 2]))
    }
    // moving: displacement against the distance to the nearest surface (what parallax scales with)
    const surface = Math.max(1e-5, bulbDE(camLocal.x, camLocal.y, camLocal.z, this.shared.uPower.value))
    const shift = camLocal.distanceTo(this.drawnCam) / surface
    // projection: zoom and the rig's view offset
    const p = camera.projectionMatrix.elements
    const q = this.drawnProjection
    const proj =
      (Math.abs(p[8] - q[8]) * W) / 2 +
      (Math.abs(p[9] - q[9]) * H) / 2 +
      (Math.abs(p[0] / q[0] - 1) * W) / 2 +
      (Math.abs(p[5] / q[5] - 1) * H) / 2
    return (turn + shift) * focalPx + proj > MOVE_PX || p[11] !== q[11] || p[15] !== q[15]
  }

  /** (Re)allocate when the march (w x h) outgrows the target or shrinks well below it. */
  private ensureTarget(w: number, h: number, W: number, H: number): void {
    if (this.target && w <= this.allocW && h <= this.allocH && w * h >= SHRINK_AREA * this.allocW * this.allocH) return
    const aw = Math.max(w, Math.min(W, Math.ceil((w * GROW_HEADROOM) / QUANTUM) * QUANTUM))
    const ah = Math.max(h, Math.min(H, Math.ceil((h * GROW_HEADROOM) / QUANTUM) * QUANTUM))
    this.target?.dispose()
    this.target = new THREE.WebGLRenderTarget(aw, ah, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    this.allocW = aw
    this.allocH = ah
    this.displayUniforms.uMarch.value = this.target.texture
    this.displayUniforms.uAlloc.value.set(aw, ah)
    this.valid = false
  }

  private march(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    mesh: THREE.Object3D,
    W: number,
    H: number,
    scale: number,
    focalPx: number,
  ): void {
    const target = this.target
    if (!target) return
    const rw = Math.max(1, Math.min(this.allocW, Math.round(W * scale)))
    const rh = Math.max(1, Math.min(this.allocH, Math.round(H * scale)))
    // radians per march texel: one framebuffer pixel subtends 1 / focalPx
    this.marchUniforms.uPixelAngle.value = H / (focalPx * rh)

    const pc = this.proxyCamera
    pc.projectionMatrix.copy(camera.projectionMatrix)
    pc.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
    pc.matrixWorld.copy(camera.matrixWorld)
    pc.matrixWorldInverse.copy(camera.matrixWorldInverse)
    this.proxy.matrixWorld.copy(mesh.matrixWorld)

    const prevTarget = renderer.getRenderTarget()
    const prevFace = renderer.getActiveCubeFace()
    const prevMip = renderer.getActiveMipmapLevel()
    const prevAutoClear = renderer.autoClear
    const prevXr = renderer.xr.enabled
    const prevShadow = renderer.shadowMap.autoUpdate
    const prevAlpha = renderer.getClearAlpha()
    renderer.getClearColor(savedClear)
    renderer.autoClear = false
    renderer.xr.enabled = false // otherwise render() swaps in the XR camera
    renderer.shadowMap.autoUpdate = false

    target.viewport.set(0, 0, rw, rh)
    target.scissorTest = false
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0) // a = 0: no hit
    renderer.clear(true, false, false)
    renderer.render(this.scene, pc)

    renderer.setClearColor(savedClear, prevAlpha)
    renderer.setRenderTarget(prevTarget, prevFace, prevMip)
    renderer.autoClear = prevAutoClear
    renderer.xr.enabled = prevXr
    renderer.shadowMap.autoUpdate = prevShadow

    this.displayUniforms.uMarchSize.value.set(rw, rh)
    bulbStats.texels = rw * rh

    // remember what this picture was drawn from
    this.valid = true
    this.drawnScale = scale
    this.drawnW = W
    this.drawnH = H
    this.drawnPower = this.shared.uPower.value
    this.drawnCam.copy(this.shared.uCamLocal.value)
    const m = camera.matrixWorld.elements
    for (let c = 0; c < 3; c++) {
      basis.set(m[4 * c], m[4 * c + 1], m[4 * c + 2]).normalize()
      this.drawnBasis[3 * c] = basis.x
      this.drawnBasis[3 * c + 1] = basis.y
      this.drawnBasis[3 * c + 2] = basis.z
    }
    this.drawnProjection.set(camera.projectionMatrix.elements)
    this.drawnModel.copy(mesh.matrixWorld)
  }
}
