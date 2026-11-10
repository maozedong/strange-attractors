/**
 * The stage: one renderer, one scene graph, one camera, one field of dust, and the frame loop
 * that drives them. Scenes are guests here: they add props to `scene`, hand sources to `dust`,
 * ask `rig` for shots and `labels` for words. The film (src/film) decides which scene is on.
 */
import * as THREE from 'three'
import { Backdrop } from './Backdrop'
import { CameraRig } from './CameraRig'
import { Dust, defaultLook } from './Dust'
import { Labels } from './Labels'
import { PALETTES, type ActId, type Palette } from './palettes'
import { Post } from './post'

export type FrameFn = (dt: number, time: number, realDt: number) => void

function chooseDustSize(): number {
  const n = Number(new URLSearchParams(window.location.search).get('n'))
  if ([128, 256, 512, 1024].includes(n)) return n
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const mobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)
  const lowCore = nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4
  return mobile || lowCore ? 256 : 512
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig = new CameraRig()
  readonly dust: Dust
  readonly backdrop: Backdrop
  readonly labels: Labels
  readonly post: Post
  /** the dust is `size × size` particles */
  readonly size: number
  readonly canvas: HTMLCanvasElement

  /** film time: stops while paused, runs faster with `speed` */
  time = 0
  /** multiplier on film time (development and capture) */
  speed = 1
  paused = false
  /** frames are stepped by hand (capture) */
  manual = false
  act: ActId = 0
  width = 1
  height = 1
  /** smoothed frames per second */
  fps = 60

  private readonly frameFns = new Set<FrameFn>()
  private raf = 0
  private last = 0
  private dpr = 1
  private maxDpr: number
  private slow = 0
  private running = false
  private readonly host: HTMLElement

  /** @throws Error with a readable reason when the GPU cannot run the film */
  constructor(host: HTMLElement) {
    this.host = host
    const canvas = document.createElement('canvas')
    canvas.className = 'stage'
    host.prepend(canvas)
    this.canvas = canvas

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true })
    if (!gl) throw new Error('This film needs WebGL 2, which this browser or graphics card does not provide.')
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This film needs floating-point render targets (EXT_color_buffer_float), which this graphics card does not support.')
    }
    gl.getExtension('OES_texture_float_linear')

    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.info.autoReset = true

    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2)
    this.dpr = this.maxDpr
    this.size = chooseDustSize()

    const palette = PALETTES[0]
    this.backdrop = new Backdrop(palette)
    this.scene.add(this.backdrop.mesh)
    this.dust = new Dust(this.renderer, this.size, defaultLook(palette))
    this.scene.add(this.dust.object)
    this.labels = new Labels(host)
    this.post = new Post(this.renderer, this.scene, this.rig.camera)
    this.rig.attach(canvas)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.rig.breath = 0

    const onResize = () => this.resize()
    window.addEventListener('resize', onResize)
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault())
    // the simulation state lives on the GPU; after a context loss the honest fix is a fresh start
    canvas.addEventListener('webglcontextrestored', () => window.location.reload())
    this.resize()
  }

  get palette(): Palette {
    return PALETTES[this.act]
  }

  /** change act: the room's colours cross-fade; scenes pick up the new ramp from `palette` */
  setAct(act: ActId) {
    this.act = act
    this.backdrop.setPalette(PALETTES[act])
    document.documentElement.style.setProperty('--accent', PALETTES[act].accent)
  }

  onFrame(fn: FrameFn): () => void {
    this.frameFns.add(fn)
    return () => this.frameFns.delete(fn)
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      if (this.manual) return
      const real = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000))
      this.last = now
      this.frame(real)
      this.watchSpeed(real)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  /** advance exactly one frame of `dt` seconds (capture) */
  step(dt: number) {
    this.frame(dt)
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth
    const h = this.host.clientHeight || window.innerHeight
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h)
    this.rig.setSize(w, h)
  }

  private frame(real: number) {
    const dt = this.paused ? 0 : real * this.speed
    this.time += dt
    for (const fn of this.frameFns) fn(dt, this.time, real)
    this.rig.update(real)
    const cam = this.rig.camera
    this.dust.focus = this.rig.focus
    this.dust.aperture = this.rig.aperture
    this.dust.update(dt, this.time, cam, this.width * this.dpr, this.height * this.dpr)
    this.backdrop.floorY = this.dust.floorY ?? this.backdrop.floorY
    this.backdrop.update(real, this.time, cam)
    this.labels.update(cam, this.width, this.height)
    this.post.render(real)
  }

  /** if the machine cannot hold the frame rate, give up resolution before smoothness */
  private watchSpeed(real: number) {
    this.fps += (1 / real - this.fps) * 0.05
    if (document.hidden) return
    this.slow = this.fps < 44 ? this.slow + real : Math.max(0, this.slow - real * 0.5)
    if (this.slow > 2.5 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25)
      this.slow = 0
      this.resize()
    }
  }
}
