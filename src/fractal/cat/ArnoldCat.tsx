import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { fullscreenVert } from '../../sim/shaders/fullscreen'
import { CAT_N, CAT_PERIOD } from './catMap'
import { displayFrag, displayVert, gatherFrag } from './shaders'
import { captureCamera, catStatus, getCameraPixels, getCameraSerial, getCatPixels, loadCatPixels } from './sources'

export { captureCamera, catStatus }

const INK = '#efe8dc'
const BORDER_OPACITY = 0.25
/** Most cat-map passes run in one frame (each is one 256 x 256 copy). */
const MAX_STEPS_PER_FRAME = 64
/** A frame longer than this (tab switch, hitch) is counted as this long. */
const MAX_DT = 0.25
/** Store writes of `cat.step`: at most every WRITE_INTERVAL seconds ... */
const WRITE_INTERVAL = 0.1
/** ... plus promptly whenever the step crosses a multiple of MARK (12 marks per period) ... */
const MARK = 16
/** ... but those mark writes no closer together than this, so fast-forward stays cheap. */
const MARK_GAP = 1 / 30

/** True number of steps applied to the picture on screen (the store copy is throttled). */
let catStep = 0

/** Steps applied so far, exact and current (`cat.step` in the store lags by up to 0.1 s). */
export function getCatStep(): number {
  return catStep
}

export interface ArnoldCatProps {
  /** Plane size in render units, centred on the group origin, in the XY plane facing +Z. */
  width: number
  height: number
}

type Source = 'cat' | 'camera'

interface GatherUniforms {
  [name: string]: THREE.IUniform
  uSrc: { value: THREE.Texture | null }
  uN: { value: number }
}

interface Rig {
  renderer: THREE.WebGLRenderer
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
  /** the source picture on the GPU; re-copied into `read` on every reset */
  source: THREE.DataTexture
  sourceData: Uint8Array
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  gather: GatherUniforms
  copyMaterial: THREE.ShaderMaterial
  stepMaterial: THREE.ShaderMaterial
  display: THREE.ShaderMaterial
  displayMap: { value: THREE.Texture | null }

  /** picture currently loaded into the targets (null until the first upload) */
  shown: Source | null
  /** camera serial of that picture */
  shownSerial: number
  /** `cat.resetSerial` already acted on */
  resetSerial: number
  /** last `cat.source` seen, to notice the switch to 'camera' */
  seenSource: Source | null
  /** fractional steps owed */
  acc: number
  /** last step written to the store, and when (clock seconds) */
  written: number
  lastWrite: number
  /** WebGL context was restored: GPU contents are gone, rebuild them */
  restored: boolean

  // renderer state saved around a batch of passes (fields, so no per-frame allocation)
  savedTarget: THREE.WebGLRenderTarget | null
  savedFace: number
  savedMip: number
  savedAutoClear: boolean
  savedXr: boolean
  savedShadowAuto: boolean
}

function createRig(renderer: THREE.WebGLRenderer, resetSerial: number): Rig {
  const N = CAT_N
  const targetOptions: THREE.RenderTargetOptions = {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  }
  const read = new THREE.WebGLRenderTarget(N, N, targetOptions)
  const write = new THREE.WebGLRenderTarget(N, N, targetOptions)
  read.texture.name = 'ArnoldCat.A'
  write.texture.name = 'ArnoldCat.B'

  const sourceData = new Uint8Array(N * N * 4)
  const source = new THREE.DataTexture(sourceData, N, N, THREE.RGBAFormat, THREE.UnsignedByteType)
  source.name = 'ArnoldCat.source'
  source.minFilter = THREE.NearestFilter
  source.magFilter = THREE.NearestFilter
  source.generateMipmaps = false
  source.flipY = false // rows are already bottom-up (see sources.ts)

  const gather: GatherUniforms = { uSrc: { value: null }, uN: { value: N } }
  const passMaterial = (name: string, defines: Record<string, string>) =>
    new THREE.ShaderMaterial({
      name,
      defines,
      vertexShader: fullscreenVert,
      fragmentShader: gatherFrag,
      uniforms: gather,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  const copyMaterial = passMaterial('ArnoldCat.copy', {})
  const stepMaterial = passMaterial('ArnoldCat.step', { CAT_STEP: '' })

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)

  const displayMap = { value: null as THREE.Texture | null }
  const display = new THREE.ShaderMaterial({
    name: 'ArnoldCat.display',
    vertexShader: displayVert,
    fragmentShader: displayFrag,
    uniforms: { uMap: displayMap },
    side: THREE.DoubleSide,
    // push the picture back a hair so the coplanar border always wins the depth test
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })

  return {
    renderer,
    read,
    write,
    source,
    sourceData,
    scene,
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    quad,
    gather,
    copyMaterial,
    stepMaterial,
    display,
    displayMap,
    shown: null,
    shownSerial: -1,
    resetSerial,
    seenSource: null,
    acc: 0,
    written: -1,
    lastWrite: -Infinity,
    restored: false,
    savedTarget: null,
    savedFace: 0,
    savedMip: 0,
    savedAutoClear: true,
    savedXr: false,
    savedShadowAuto: true,
  }
}

function disposeRig(r: Rig): void {
  r.read.dispose()
  r.write.dispose()
  r.source.dispose()
  r.copyMaterial.dispose()
  r.stepMaterial.dispose()
  r.display.dispose()
  r.quad.geometry.dispose()
}

/** Save the renderer state the passes touch. Pair with end(). */
function begin(r: Rig): void {
  const gl = r.renderer
  r.savedTarget = gl.getRenderTarget()
  r.savedFace = gl.getActiveCubeFace()
  r.savedMip = gl.getActiveMipmapLevel()
  r.savedAutoClear = gl.autoClear
  r.savedXr = gl.xr.enabled
  r.savedShadowAuto = gl.shadowMap.autoUpdate
  gl.autoClear = false // every pass overwrites every texel
  gl.xr.enabled = false // otherwise render() swaps our camera for the XR camera
  gl.shadowMap.autoUpdate = false
}

function end(r: Rig): void {
  const gl = r.renderer
  gl.setRenderTarget(r.savedTarget, r.savedFace, r.savedMip)
  gl.autoClear = r.savedAutoClear
  gl.xr.enabled = r.savedXr
  gl.shadowMap.autoUpdate = r.savedShadowAuto
  r.savedTarget = null
}

function pass(r: Rig, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
  r.quad.material = material
  r.renderer.setRenderTarget(target)
  r.renderer.render(r.scene, r.camera)
}

/** Copy the source picture into `read` (step 0). Inside begin/end. */
function copySource(r: Rig): void {
  r.gather.uSrc.value = r.source
  pass(r, r.copyMaterial, r.read)
}

/** Apply `n` cat-map steps to `read`. Inside begin/end. */
function runSteps(r: Rig, n: number): void {
  for (let i = 0; i < n; i++) {
    r.gather.uSrc.value = r.read.texture
    pass(r, r.stepMaterial, r.write)
    const t = r.read
    r.read = r.write
    r.write = t
  }
}

function writeStep(r: Rig, now: number): void {
  r.written = catStep
  r.lastWrite = now
  useStore.getState().setCat({ step: catStep })
}

/**
 * Arnold's cat map applied to a photo, one exact pixel permutation per step, on an
 * N x N grid (CAT_N). Follows `cat` in the store every frame without re-rendering:
 * `rate` steps per second (at most 64 per frame), `stopAt` as a hard stop, `resetSerial`
 * and `source` restart at step 0. The picture comes back bit-identical at every multiple of
 * CAT_PERIOD; a frame never steps past one, so the return is always on screen for at least
 * a frame and its exact step is written to the store that frame.
 *
 * `source: 'camera'` uses the last snapshot, or takes one (see captureCamera) if there is
 * none yet; the cat stays up until it arrives.
 */
export function ArnoldCat({ width, height }: ArnoldCatProps) {
  const gl = useThree((s) => s.gl)
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const groupRef = useRef<THREE.Group>(null)

  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])
  useEffect(() => () => geometry.dispose(), [geometry])
  const border = useMemo<[number, number, number][]>(() => {
    const x = width / 2
    const y = height / 2
    return [
      [-x, -y, 0],
      [x, -y, 0],
      [x, y, 0],
      [-x, y, 0],
      [-x, -y, 0],
    ]
  }, [width, height])

  useEffect(() => {
    void loadCatPixels()
    catStep = 0 // a new mount starts from the picture, not where the last visit stopped
    const next = createRig(gl, useStore.getState().cat.resetSerial)
    const canvas = gl.domElement
    const onRestored = () => {
      next.restored = true
    }
    canvas.addEventListener('webglcontextrestored', onRestored)
    rigRef.current = next
    setRig(next)
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      disposeRig(next)
      setRig(null)
    }
  }, [gl])

  useFrame((state, delta) => {
    const r = rigRef.current
    if (!r) return
    const cat = useStore.getState().cat
    const now = state.clock.elapsedTime

    // switching to the camera takes a snapshot if there is none yet; after a failed attempt
    // it falls back to the cat instead of prompting again outside a click
    if (cat.source !== r.seenSource) {
      r.seenSource = cat.source
      if (cat.source === 'camera' && getCameraPixels() === null && !catStatus.capturing) {
        if (catStatus.cameraError === null) void captureCamera()
        else useStore.getState().setCat({ source: 'cat' })
      }
    }

    // which picture should be up: the camera snapshot once there is one, else the cat
    const camera = cat.source === 'camera' ? getCameraPixels() : null
    const want: Source = camera ? 'camera' : 'cat'
    const pixels = camera ?? getCatPixels()
    if (!pixels) return // the photo is still decoding; the group stays hidden
    const serial = camera ? getCameraSerial() : 0

    let reset = false
    if (want !== r.shown || serial !== r.shownSerial) {
      r.sourceData.set(pixels)
      r.source.needsUpdate = true
      r.shown = want
      r.shownSerial = serial
      reset = true
    }
    if (cat.resetSerial !== r.resetSerial) {
      r.resetSerial = cat.resetSerial
      reset = true
    }

    // how many steps this frame: rate x dt, capped, never past stopAt or the next return
    let n = 0
    if (!reset) {
      const rate = cat.rate > 0 && Number.isFinite(cat.rate) ? cat.rate : 0
      r.acc += rate * Math.min(delta, MAX_DT)
      n = Math.min(Math.floor(r.acc), MAX_STEPS_PER_FRAME)
      r.acc -= Math.floor(r.acc) // a capped backlog is dropped, not carried
      if (cat.stopAt !== null && catStep + n >= cat.stopAt) {
        n = Math.max(0, Math.floor(cat.stopAt) - catStep)
        r.acc = 0
      }
      const toReturn = CAT_PERIOD - (catStep % CAT_PERIOD)
      if (n >= toReturn) {
        n = toReturn
        r.acc = 0
      }
    }

    if (reset || r.restored || n > 0) {
      begin(r)
      if (reset) {
        copySource(r)
        catStep = 0
        r.acc = 0
      } else if (r.restored) {
        // the targets were wiped; the permutation is exact, so replaying the steps rebuilds them
        r.source.needsUpdate = true
        copySource(r)
        runSteps(r, catStep % CAT_PERIOD)
      }
      r.restored = false
      runSteps(r, n)
      end(r)
      catStep += n
      r.displayMap.value = r.read.texture
      if (groupRef.current) groupRef.current.visible = true
    }

    // publish the step: exact at a reset, a return, or stopAt; otherwise throttled
    if (reset) {
      writeStep(r, now)
    } else if (catStep !== r.written) {
      const since = now - r.lastWrite
      const landed =
        (n > 0 && catStep % CAT_PERIOD === 0) || (cat.stopAt !== null && catStep === Math.floor(cat.stopAt))
      const marked = Math.floor(catStep / MARK) !== Math.floor(r.written / MARK) && since >= MARK_GAP
      if (landed || marked || since >= WRITE_INTERVAL) writeStep(r, now)
    }
  })

  if (!rig) return null
  return (
    <group ref={groupRef} visible={rig.shown !== null}>
      <mesh geometry={geometry} material={rig.display} />
      <Line points={border} color={INK} lineWidth={1} transparent opacity={BORDER_OPACITY} depthWrite={false} />
    </group>
  )
}
