import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import type { MandelView } from '../types'
import { FractalSurface, type Quality } from './FractalSurface'
import { clampScale, computeReferenceOrbit, maxIterForScale, ORBIT_CAPACITY, ORBIT_TEXELS } from './orbit'
import { mandelIterationFrag } from './shaders'
import { animateMandelTo, cancelMandelFlight, setFlightViewWidth } from './tween'

export { animateMandelTo }

export interface MandelbrotPlaneProps {
  /** Plane size in render units, centred on the group origin and facing +Z. */
  width: number
  height: number
  /** 1 (default): 2x2 rotated-grid supersampling. 0: one sample per pixel, about 4x cheaper. */
  quality?: Quality
}

/** wheel zoom per notch */
const WHEEL_ZOOM = 1.15
/** a press that travels less than this (CSS px) before release is a click */
const CLICK_SLOP = 4
/** cursor ring fade rate, 1/s */
const CURSOR_FADE = 6

interface Rig {
  surface: FractalSurface
  orbit: THREE.DataTexture
  orbitData: Float32Array
  /** what the reference orbit and uniforms were last built for (compared by value each frame) */
  cx: number
  cy: number
  maxIter: number
  scale: number
  width: number
  height: number
  span: THREE.Vector2
  cursorOn: number
}

interface Drag {
  pointerId: number
  mode: 'pan' | 'pick'
  /** press position, CSS px */
  x: number
  y: number
  moved: boolean
  /** pan anchor: plane uv and view centre when the anchor was set */
  u: number
  v: number
  cx: number
  cy: number
}

/**
 * Temporarily switches one OrbitControls capability off (zoom while the pointer is over an
 * interactive plane, rotate while dragging on it) and restores the value it found. `enabled`
 * itself is left alone: drei only calls controls.update() while enabled, and the camera rig
 * relies on that.
 */
class ControlsLock {
  private target: Record<string, unknown> | null = null
  private saved: unknown = true
  constructor(private readonly key: 'enableZoom' | 'enableRotate') {}
  hold(controls: unknown): void {
    if (this.target || !controls || typeof controls !== 'object') return
    const c = controls as Record<string, unknown>
    if (typeof c[this.key] !== 'boolean') return
    this.target = c
    this.saved = c[this.key]
    c[this.key] = false
  }
  release(): void {
    if (!this.target) return
    this.target[this.key] = this.saved
    this.target = null
  }
}

function createOrbitTexture(data: Float32Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, ORBIT_TEXELS, 1, THREE.RGBAFormat, THREE.FloatType)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

const inverseWorld = new THREE.Matrix4()
const localRay = new THREE.Ray()

/**
 * Where a ray meets the plane, in plane uv (outside [0, 1] when it misses the rectangle).
 * Used instead of event.uv because a captured drag keeps reporting the capture-time hit.
 */
function rayToUv(ray: THREE.Ray, mesh: THREE.Object3D, width: number, height: number, out: THREE.Vector2): boolean {
  inverseWorld.copy(mesh.matrixWorld).invert()
  localRay.copy(ray).applyMatrix4(inverseWorld)
  const dz = localRay.direction.z
  if (Math.abs(dz) < 1e-12) return false
  const t = -localRay.origin.z / dz
  if (t < 0) return false
  out.set(
    (localRay.origin.x + t * localRay.direction.x) / width + 0.5,
    (localRay.origin.y + t * localRay.direction.y) / height + 0.5,
  )
  return true
}

/** Wheel notches from a wheel event: about one per detent for pixel, line and page modes. */
function wheelNotches(e: WheelEvent): number {
  let n = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100
  // trackpad pinch arrives as ctrl+wheel with small pixel deltas
  if (e.ctrlKey) n *= 6
  return Math.max(-5, Math.min(5, n))
}

function approach(x: number, target: number, rate: number, dt: number): number {
  const v = THREE.MathUtils.damp(x, target, rate, dt)
  return Math.abs(target - v) < 1e-3 ? target : v
}

/**
 * The Mandelbrot set for the store's `fractal.mandel` view, drawn on a width x height plane
 * (see targets.ts for what `scale` means). Deep zooms to scale 1e-13 use perturbation around
 * a double-precision reference orbit (shaders.ts). Never re-renders per frame: the view is read
 * with getState() in useFrame; the component subscribes only to the two interaction flags.
 *
 * With `fractal.mandelInteractive`: wheel zooms about the pointer, drag pans. With
 * `fractal.juliaPickable`: a click or drag sets `fractal.julia` instead of panning, and a ring
 * marks it. While the pointer is over an interactive plane the orbit controls' zoom and rotate
 * are switched off (and restored afterwards) so the gestures do not also move the camera.
 */
export function MandelbrotPlane({ width, height, quality = 1 }: MandelbrotPlaneProps) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const eventSource = useThree((s) => s.events.connected) as HTMLElement | undefined
  const interactive = useStore((s) => s.fractal.mandelInteractive)
  const pickable = useStore((s) => s.fractal.juliaPickable)

  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const size = useRef({ width, height })
  size.current.width = width
  size.current.height = height
  const qualityRef = useRef<Quality>(quality)
  qualityRef.current = quality

  const hovering = useRef(false)
  const drag = useRef<Drag | null>(null)
  const endDrag = useRef<() => void>(() => {})
  const locks = useMemo(() => ({ zoom: new ControlsLock('enableZoom'), rotate: new ControlsLock('enableRotate') }), [])

  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => setFlightViewWidth(width), [width])

  useEffect(() => {
    try {
      FractalSurface.check(gl)
    } catch (e) {
      console.error('[MandelbrotPlane]', e)
      return
    }
    const orbitData = new Float32Array(ORBIT_CAPACITY * 2)
    const orbit = createOrbitTexture(orbitData)
    const surface = new FractalSurface({
      name: 'Mandelbrot',
      fragmentShader: mandelIterationFrag,
      uniforms: { uOrbit: { value: orbit }, uRefLen: { value: 1 }, uMaxIter: { value: 200 } },
    })
    const next: Rig = {
      surface,
      orbit,
      orbitData,
      cx: NaN,
      cy: NaN,
      maxIter: 0,
      scale: NaN,
      width: 0,
      height: 0,
      span: new THREE.Vector2(1, 1),
      cursorOn: useStore.getState().fractal.juliaPickable ? 1 : 0,
    }
    const canvas = gl.domElement
    const onRestored = () => {
      surface.invalidate()
      orbit.needsUpdate = true
    }
    canvas.addEventListener('webglcontextrestored', onRestored)
    rigRef.current = next
    setRig(next)
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      surface.dispose()
      orbit.dispose()
      setRig(null)
    }
  }, [gl])

  // the GPU work runs as the mesh is drawn, with the camera actually in use
  useEffect(() => {
    const mesh = meshRef.current
    if (!rig || !mesh) return
    mesh.onBeforeRender = (renderer, _scene, camera) =>
      rig.surface.render(renderer, camera, mesh, size.current.width, size.current.height)
    return () => {
      mesh.onBeforeRender = () => {}
    }
  }, [rig])

  useFrame((state, delta) => {
    const r = rigRef.current
    if (!r) return
    const { mandel, julia, juliaPickable } = useStore.getState().fractal
    const { width: w, height: h } = size.current
    const it = r.surface.iterationUniforms
    const maxIter = maxIterForScale(mandel.scale)
    let changed = false

    // reference orbit for c_ref = the view centre, rebuilt only when centre or budget change
    if (mandel.cx !== r.cx || mandel.cy !== r.cy || maxIter !== r.maxIter) {
      it.uRefLen.value = computeReferenceOrbit(mandel.cx, mandel.cy, maxIter, r.orbitData)
      it.uMaxIter.value = maxIter
      r.orbit.needsUpdate = true
      r.cx = mandel.cx
      r.cy = mandel.cy
      r.maxIter = maxIter
      changed = true
    }
    if (mandel.scale !== r.scale || w !== r.width || h !== r.height) {
      r.scale = mandel.scale
      r.width = w
      r.height = h
      changed = true
    }
    r.span.set(mandel.scale * w, mandel.scale * h)

    // Julia cursor, in plane uv (computed in doubles: the offset can be tiny or huge)
    const pu = r.surface.uniforms
    pu.uCursor.value.set((julia.cx - mandel.cx) / r.span.x + 0.5, (julia.cy - mandel.cy) / r.span.y + 0.5)
    r.cursorOn = approach(r.cursorOn, juliaPickable ? 1 : 0, CURSOR_FADE, delta)
    pu.uCursorOn.value = r.cursorOn

    r.surface.prepare(changed, r.span, qualityRef.current, delta, state.clock.elapsedTime)
  })

  const handlers = useMemo(() => {
    const st = useStore.getState
    const uv = new THREE.Vector2()
    const pointAt = (e: { ray: THREE.Ray }): boolean => {
      const mesh = meshRef.current
      return mesh !== null && rayToUv(e.ray, mesh, size.current.width, size.current.height, uv)
    }
    const setCursor = (c: string) => {
      gl.domElement.style.cursor = c
    }
    const restingCursor = () => (st().fractal.juliaPickable ? 'crosshair' : 'grab')
    const pickAt = (u: number, v: number) => {
      const { mandel } = st().fractal
      st().setFractal({
        julia: {
          cx: mandel.cx + (u - 0.5) * mandel.scale * size.current.width,
          cy: mandel.cy + (v - 0.5) * mandel.scale * size.current.height,
        },
      })
    }
    const anchor = (d: Drag, u: number, v: number) => {
      const { mandel } = st().fractal
      d.u = u
      d.v = v
      d.cx = mandel.cx
      d.cy = mandel.cy
    }
    const end = () => {
      drag.current = null
      locks.rotate.release()
      if (hovering.current) {
        setCursor(restingCursor())
      } else {
        locks.zoom.release()
        setCursor('')
      }
    }
    const endIf = (e: ThreeEvent<PointerEvent>) => {
      if (drag.current?.pointerId === e.pointerId) end()
    }

    endDrag.current = end
    return {
      onPointerOver: () => {
        hovering.current = true
        if (st().fractal.mandelInteractive) locks.zoom.hold(get().controls)
        if (!drag.current) setCursor(restingCursor())
      },
      onPointerOut: () => {
        hovering.current = false
        if (!drag.current) {
          locks.zoom.release()
          setCursor('')
        }
      },
      onWheel: (e: ThreeEvent<WheelEvent>) => {
        const { fractal, setFractal } = st()
        if (!fractal.mandelInteractive || !pointAt(e)) return
        e.stopPropagation()
        locks.zoom.hold(get().controls)
        cancelMandelFlight()
        // zoom about the pointed point: it keeps its place on the plane
        const v: MandelView = fractal.mandel
        const scale = clampScale(v.scale * Math.pow(WHEEL_ZOOM, wheelNotches(e.nativeEvent)))
        // centre moves by the pointer's offset times the change in scale (computed as a
        // displacement, so no tiny offset is ever added to and subtracted from an O(1) centre)
        const ds = v.scale - scale
        setFractal({
          mandel: {
            cx: v.cx + (uv.x - 0.5) * size.current.width * ds,
            cy: v.cy + (uv.y - 0.5) * size.current.height * ds,
            scale,
          },
        })
        if (drag.current?.mode === 'pan') anchor(drag.current, uv.x, uv.y)
      },
      onPointerDown: (e: ThreeEvent<PointerEvent>) => {
        const { fractal } = st()
        if (!fractal.mandelInteractive && !fractal.juliaPickable) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (!pointAt(e)) return
        e.stopPropagation()
        if (drag.current) end() // a gesture that never reported its end
        locks.rotate.hold(get().controls)
        ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
        const d: Drag = {
          pointerId: e.pointerId,
          mode: fractal.juliaPickable ? 'pick' : 'pan',
          x: e.clientX,
          y: e.clientY,
          moved: false,
          u: 0,
          v: 0,
          cx: 0,
          cy: 0,
        }
        if (d.mode === 'pan') {
          cancelMandelFlight() // grabbing the picture stops a flight where it is
          setCursor('grabbing')
        }
        anchor(d, uv.x, uv.y)
        drag.current = d
      },
      onPointerMove: (e: ThreeEvent<PointerEvent>) => {
        const d = drag.current
        if (!d || e.pointerId !== d.pointerId || !pointAt(e)) return
        e.stopPropagation()
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) d.moved = true
        if (d.mode === 'pan') {
          // grab-and-drag: the point pressed stays under the pointer
          const { mandel } = st().fractal
          st().setFractal({
            mandel: {
              cx: d.cx - (uv.x - d.u) * mandel.scale * size.current.width,
              cy: d.cy - (uv.y - d.v) * mandel.scale * size.current.height,
              scale: mandel.scale,
            },
          })
        } else if (d.moved) {
          pickAt(uv.x, uv.y)
        }
      },
      onPointerUp: (e: ThreeEvent<PointerEvent>) => {
        const d = drag.current
        if (!d || e.pointerId !== d.pointerId) return
        e.stopPropagation()
        if (d.mode === 'pick' && !d.moved && pointAt(e)) pickAt(uv.x, uv.y)
        end()
      },
      onPointerCancel: endIf,
      onLostPointerCapture: endIf,
    }
  }, [gl, get, locks])

  // stop swallowing page zoom / scroll (trackpad pinch is ctrl+wheel) while zooming the picture;
  // R3F's own wheel listener is passive and cannot
  useEffect(() => {
    if (!interactive) return
    const el = eventSource ?? gl.domElement
    const onWheel = (e: WheelEvent) => {
      if (hovering.current) e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [interactive, eventSource, gl])

  // End drags from the window as well: R3F does not reliably deliver pointercancel or a lost
  // capture to the mesh, and a drag left open would keep the camera's rotate locked.
  useEffect(() => {
    if (!interactive && !pickable) return
    const onEnd = (e: Event) => {
      const d = drag.current
      if (d && (!(e instanceof PointerEvent) || e.pointerId === d.pointerId)) endDrag.current()
    }
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    window.addEventListener('blur', onEnd)
    return () => {
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('blur', onEnd)
    }
  }, [interactive, pickable])

  // hand the camera controls back when interaction is switched off, and on unmount
  useEffect(() => {
    if (!interactive) locks.zoom.release()
    if (!interactive && !pickable) {
      if (drag.current) drag.current = null
      locks.rotate.release()
      if (hovering.current) gl.domElement.style.cursor = ''
      hovering.current = false
    }
  }, [interactive, pickable, locks, gl])
  useEffect(
    () => () => {
      locks.zoom.release()
      locks.rotate.release()
      if (hovering.current || drag.current) gl.domElement.style.cursor = ''
    },
    [locks, gl],
  )

  if (!rig) return null
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={rig.surface.material}
      {...(interactive || pickable ? handlers : undefined)}
    />
  )
}
