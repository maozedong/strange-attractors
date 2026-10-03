import * as THREE from 'three'
import { PALETTE_DRIFT, planeFrag, planeVert } from './shaders'

/**
 * Everything a fractal plane needs except the fractal itself: an iteration cache that is
 * recomputed only when something changes, and the cheap material that displays it.
 *
 * The cache is screen-space. The plane is drawn with the scene camera into a float target that
 * covers just its on-screen rectangle, so iteration runs once per visible pixel (the rasterizer
 * clips the rest of a plane that overfills the view) and the display fetches its own pixel back
 * exactly, with no resampling. It is redrawn when the view changes, when the plane moves more
 * than MOVE_TOLERANCE pixels on screen (a camera move), or when the framebuffer resizes. A still
 * picture costs one texture fetch and a palette lookup per pixel per frame, which is what lets
 * the palette drift without re-running 4000-iteration loops.
 *
 * While things keep changing (a scripted zoom, a drag) the cache is redrawn every frame at a
 * resolution that adapts to the frame time, so slow GPUs stay responsive. After SETTLE seconds
 * without change it is redrawn once at full resolution, or, when the measured cost says a
 * full-resolution draw would hold one frame longer than REST_BUDGET (a deep zoom with 4000
 * iterations on a weak GPU at a high pixel ratio), at the largest resolution that fits: a
 * multi-second draw would trip the GPU watchdog and lose the WebGL context.
 *
 * All GPU work happens in the mesh's onBeforeRender, so the cache always matches the camera the
 * scene is being drawn with. The scene must be drawn with one camera per frame.
 */

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Redraw once any plane corner has moved this many framebuffer pixels since the cache was drawn. */
const MOVE_TOLERANCE = 0.35
/** Allocation granularity, growth headroom, and the area fraction below which the target shrinks. */
const QUANTUM = 64
const GROW_HEADROOM = 1.1
const SHRINK_AREA = 0.45
/** Dynamic resolution while moving: per-axis scale floor, and the frame times that move it. */
const MIN_MOTION_SCALE = 0.25
const SLOW_FRAME = 1 / 40
const FAST_FRAME = 1 / 55
/** Longest a still-picture redraw may hold a frame, seconds, and the resolution floor that budget may impose. */
const REST_BUDGET = 0.35
const MIN_REST_SCALE = 0.4
/** Seconds without change before the full-resolution redraw. */
const SETTLE = 0.2
/** The palette phase is not wrapped to [0, 1) (see planeFrag); it restarts after this many cycles. */
const SHIFT_WRAP = 1000

export type Quality = 0 | 1

/** Debug counters, for the console: how often the iteration pass ran, and at what scale. */
export const fractalSurfaceStats = { draws: 0, lastScale: 1, lastTexels: 0 }

export interface SurfaceOptions {
  name: string
  /** iteration fragment shader (see shaders.ts) */
  fragmentShader: string
  /** that shader's own uniforms; the surface adds uSpan and uQuality */
  uniforms: Record<string, THREE.IUniform>
}

function createPlaneUniforms() {
  return {
    uCache: { value: null as THREE.Texture | null },
    uAlloc: { value: new THREE.Vector2(1, 1) },
    uOrigin: { value: new THREE.Vector2(0, 0) },
    uTexelPerPx: { value: new THREE.Vector2(1, 1) },
    uSamples: { value: 4 },
    uShift: { value: 0 },
    uCursor: { value: new THREE.Vector2(-10, -10) },
    uCursorOn: { value: 0 },
    uDpr: { value: 1 },
  }
}

// scratch, shared by all surfaces (single-threaded, never held across calls)
const corner = new THREE.Vector3()
const bufferSize = new THREE.Vector2()
const subRect = new THREE.Matrix4()
const savedClear = new THREE.Color()
const CORNER_SIGNS = [-1, -1, 1, -1, -1, 1, 1, 1]

export class FractalSurface {
  /** material of the visible mesh */
  readonly material: THREE.ShaderMaterial
  readonly uniforms = createPlaneUniforms()
  /** the iteration shader's uniforms; the owner updates its entries in place */
  readonly iterationUniforms: Record<string, THREE.IUniform>

  private readonly iterationMaterial: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly proxyCamera = new THREE.Camera()
  private readonly proxy: THREE.Mesh
  private cache: THREE.WebGLRenderTarget | null = null
  private allocW = 0
  private allocH = 0

  // inputs for this frame, from prepare()
  private frameId = 0
  private pending = true
  private quality: Quality = 1
  private delta = 0

  // the state the cache was drawn in
  private drawnFrame = -1
  private cacheValid = false
  private cachedQuality: Quality = 1
  private drawnScale = 1
  private drawnW = 0
  private drawnH = 0
  private readonly drawnCorners = new Float64Array(8)
  private drawnCornersValid = false
  private readonly drawnProjection = new THREE.Matrix4()
  private readonly drawnView = new THREE.Matrix4()
  private readonly drawnModel = new THREE.Matrix4()
  /** this frame's corner pixels, and whether all four were in front of the camera */
  private readonly corners = new Float64Array(8)
  private cornersValid = false

  private motionScale = 1
  private prevMoving = false
  private staticTime = 0
  /** estimated seconds for a full-resolution redraw (0 = no measurement yet) */
  private fullCost = 0
  /** scale of the redraw made last frame, 0 if none: this frame's delta measures it */
  private lastDrawScale = 0

  constructor(options: SurfaceOptions) {
    this.iterationUniforms = {
      ...options.uniforms,
      uSpan: { value: new THREE.Vector2(1, 1) },
      uQuality: { value: 1 },
    }
    this.iterationMaterial = new THREE.ShaderMaterial({
      name: `${options.name}.iterate`,
      vertexShader: planeVert,
      fragmentShader: options.fragmentShader,
      uniforms: this.iterationUniforms,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    this.material = new THREE.ShaderMaterial({
      name: `${options.name}.plane`,
      vertexShader: planeVert,
      fragmentShader: planeFrag,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    })
    this.proxy = new THREE.Mesh(undefined, this.iterationMaterial)
    this.proxy.frustumCulled = false
    this.proxy.matrixAutoUpdate = false
    this.proxy.matrixWorldAutoUpdate = false
    this.proxyCamera.matrixAutoUpdate = false
    this.proxyCamera.matrixWorldAutoUpdate = false
    this.scene.matrixWorldAutoUpdate = false
    this.scene.add(this.proxy)
  }

  /** Throws if this renderer cannot draw into float targets. */
  static check(renderer: THREE.WebGLRenderer): void {
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error(
        'The fractal planes need the WebGL 2 extension EXT_color_buffer_float (rendering to float textures).',
      )
    }
  }

  /** GPU contents were lost (context restore): redraw on the next frame. */
  invalidate(): void {
    this.cacheValid = false
  }

  /**
   * Once per frame from useFrame, after updating `iterationUniforms`. No allocations.
   * @param changed the fractal inputs (view, parameter, plane size) differ from the last frame
   * @param span complex-plane size of the whole plane
   * @param time seconds on the shared clock; drives the palette drift, so planes stay in phase
   */
  prepare(changed: boolean, span: THREE.Vector2, quality: Quality, delta: number, time: number): void {
    this.frameId++
    if (changed) this.pending = true
    this.quality = quality
    this.delta = delta
    ;(this.iterationUniforms.uSpan.value as THREE.Vector2).copy(span)
    this.uniforms.uShift.value = reduceMotion ? 0 : (time * PALETTE_DRIFT) % SHIFT_WRAP
  }

  /** From the visible mesh's onBeforeRender: redraw the cache if needed. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, mesh: THREE.Mesh, width: number, height: number): void {
    if (this.drawnFrame === this.frameId) return
    this.drawnFrame = this.frameId
    this.uniforms.uDpr.value = renderer.getPixelRatio()

    const target = renderer.getRenderTarget()
    if (target) bufferSize.set(target.width, target.height)
    else renderer.getDrawingBufferSize(bufferSize)
    const W = bufferSize.x
    const H = bufferSize.y

    // the plane's corners in framebuffer pixels, and its clamped bounding rectangle
    const valid = this.projectCorners(camera, mesh, width, height, W, H)
    this.cornersValid = valid
    let x0 = 0
    let y0 = 0
    let x1 = W
    let y1 = H
    if (valid) {
      const c = this.corners
      x0 = Math.max(0, Math.floor(Math.min(c[0], c[2], c[4], c[6])))
      x1 = Math.min(W, Math.ceil(Math.max(c[0], c[2], c[4], c[6])))
      y0 = Math.max(0, Math.floor(Math.min(c[1], c[3], c[5], c[7])))
      y1 = Math.min(H, Math.ceil(Math.max(c[1], c[3], c[5], c[7])))
    }
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return

    // a redraw last frame shows up in this frame's delta; it scales with the texel count
    // (a cheaper reading is trusted at once, a dearer one averaged in, so one stalled frame,
    // such as the first after a tab switch, cannot pin the picture at low resolution)
    if (this.lastDrawScale > 0) {
      const sample = Math.min(10, this.delta / (this.lastDrawScale * this.lastDrawScale))
      this.fullCost = this.fullCost > 0 && sample > this.fullCost ? 0.6 * this.fullCost + 0.4 * sample : sample
      this.lastDrawScale = 0
    }
    const restScale =
      this.fullCost > REST_BUDGET ? Math.max(MIN_REST_SCALE, Math.sqrt(REST_BUDGET / this.fullCost)) : 1

    const moved = this.cameraMoved(valid, camera, mesh, W, H)
    const moving = this.pending || moved
    if (moving) {
      if (this.prevMoving) {
        // this frame's delta measured the previous frame, which also redrew the cache
        if (this.delta > SLOW_FRAME) this.motionScale = Math.max(MIN_MOTION_SCALE, this.motionScale * 0.85)
        else if (this.delta < FAST_FRAME) this.motionScale = Math.min(1, this.motionScale * 1.04)
      }
      this.staticTime = 0
    } else {
      this.staticTime += this.delta
    }
    this.prevMoving = moving

    const reallocated = this.ensureTarget(renderer, w, h, W, H)
    const refine = !moving && this.drawnScale < 0.9 * restScale && this.staticTime >= SETTLE
    if (moving || refine || reallocated || !this.cacheValid || this.quality !== this.cachedQuality) {
      const scale = moving ? this.motionScale : restScale
      this.draw(renderer, camera, mesh, x0, y0, w, h, W, H, scale)
      this.lastDrawScale = scale
      this.pending = false
    }
  }

  dispose(): void {
    this.cache?.dispose()
    this.iterationMaterial.dispose()
    this.material.dispose()
  }

  /** Into this.corners. False if a corner is behind the camera (then only the matrices can be compared). */
  private projectCorners(camera: THREE.Camera, mesh: THREE.Mesh, width: number, height: number, W: number, H: number): boolean {
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
    const near = perspective ? (camera as THREE.PerspectiveCamera).near : 0
    for (let i = 0; i < 4; i++) {
      corner.set((CORNER_SIGNS[2 * i] * width) / 2, (CORNER_SIGNS[2 * i + 1] * height) / 2, 0)
      corner.applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
      if (perspective && corner.z > -near) return false
      corner.applyMatrix4(camera.projectionMatrix)
      this.corners[2 * i] = ((corner.x + 1) / 2) * W
      this.corners[2 * i + 1] = ((corner.y + 1) / 2) * H
    }
    return true
  }

  private cameraMoved(valid: boolean, camera: THREE.Camera, mesh: THREE.Mesh, W: number, H: number): boolean {
    if (W !== this.drawnW || H !== this.drawnH) return true
    if (valid && this.drawnCornersValid) {
      for (let i = 0; i < 8; i++) if (Math.abs(this.corners[i] - this.drawnCorners[i]) > MOVE_TOLERANCE) return true
      return false
    }
    return (
      !camera.projectionMatrix.equals(this.drawnProjection) ||
      !camera.matrixWorldInverse.equals(this.drawnView) ||
      !mesh.matrixWorld.equals(this.drawnModel)
    )
  }

  /**
   * (Re)allocate when the plane's rectangle (w x h within the W x H framebuffer) outgrows the
   * target or shrinks well below it. Headroom never exceeds the framebuffer itself.
   */
  private ensureTarget(renderer: THREE.WebGLRenderer, w: number, h: number, W: number, H: number): boolean {
    if (this.cache && w <= this.allocW && h <= this.allocH && w * h >= SHRINK_AREA * this.allocW * this.allocH) {
      return false
    }
    const max = renderer.capabilities.maxTextureSize
    const aw = Math.min(max, Math.max(w, Math.min(W, Math.ceil((w * GROW_HEADROOM) / QUANTUM) * QUANTUM)))
    const ah = Math.min(max, Math.max(h, Math.min(H, Math.ceil((h * GROW_HEADROOM) / QUANTUM) * QUANTUM)))
    this.cache?.dispose()
    this.cache = new THREE.WebGLRenderTarget(aw, ah, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    this.allocW = aw
    this.allocH = ah
    this.uniforms.uCache.value = this.cache.texture
    this.uniforms.uAlloc.value.set(aw, ah)
    this.cacheValid = false
    return true
  }

  /**
   * Draw the plane into the cache through a camera whose projection is narrowed to the plane's
   * rectangle [x0, x0+w] x [y0, y0+h] of the W x H framebuffer, at `scale` resolution.
   */
  private draw(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    mesh: THREE.Mesh,
    x0: number,
    y0: number,
    w: number,
    h: number,
    W: number,
    H: number,
    scale: number,
  ): void {
    const cache = this.cache
    if (!cache) return
    const rw = Math.max(1, Math.min(this.allocW, Math.round(w * scale)))
    const rh = Math.max(1, Math.min(this.allocH, Math.round(h * scale)))

    // clip-space scale and offset taking the sub-rectangle to the full viewport
    subRect.set(W / w, 0, 0, -(2 * x0 + w - W) / w, 0, H / h, 0, -(2 * y0 + h - H) / h, 0, 0, 1, 0, 0, 0, 0, 1)
    const pc = this.proxyCamera
    pc.projectionMatrix.multiplyMatrices(subRect, camera.projectionMatrix)
    pc.projectionMatrixInverse.copy(pc.projectionMatrix).invert()
    pc.matrixWorld.copy(camera.matrixWorld)
    pc.matrixWorldInverse.copy(camera.matrixWorldInverse)
    this.proxy.geometry = mesh.geometry
    this.proxy.matrixWorld.copy(mesh.matrixWorld)
    // supersampling only pays off at full resolution; motion and low-res draws use one sample
    this.iterationUniforms.uQuality.value = scale >= 0.9 ? this.quality : 0

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

    cache.viewport.set(0, 0, rw, rh)
    cache.scissorTest = false
    renderer.setRenderTarget(cache)
    renderer.setClearColor(0x000000, 0) // 0 = "no data" for texels the plane does not cover
    renderer.clear(true, false, false)
    renderer.render(this.scene, pc)

    renderer.setClearColor(savedClear, prevAlpha)
    renderer.setRenderTarget(prevTarget, prevFace, prevMip)
    renderer.autoClear = prevAutoClear
    renderer.xr.enabled = prevXr
    renderer.shadowMap.autoUpdate = prevShadow

    fractalSurfaceStats.draws++
    fractalSurfaceStats.lastScale = scale
    fractalSurfaceStats.lastTexels = rw * rh

    const u = this.uniforms
    u.uOrigin.value.set(x0, y0)
    u.uTexelPerPx.value.set(rw / w, rh / h)
    u.uSamples.value = this.quality === 1 ? 4 : 1

    this.cacheValid = true
    this.cachedQuality = this.quality
    this.drawnScale = scale
    this.drawnW = W
    this.drawnH = H
    this.drawnCorners.set(this.corners)
    this.drawnCornersValid = this.cornersValid
    this.drawnProjection.copy(camera.projectionMatrix)
    this.drawnView.copy(camera.matrixWorldInverse)
    this.drawnModel.copy(mesh.matrixWorld)
  }
}
