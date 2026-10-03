import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { FractalSurface, type Quality } from './FractalSurface'
import { juliaIterationFrag } from './shaders'

export interface JuliaPlaneProps {
  /** Plane size in render units, centred on the group origin and facing +Z. */
  width: number
  height: number
  /** 1 (default): 2x2 rotated-grid supersampling. 0: one sample per pixel. */
  quality?: Quality
}

/** complex-plane width the plane spans; centred on 0, height follows the plane's aspect */
const JULIA_SPAN = 3.4

interface Rig {
  surface: FractalSurface
  c: THREE.Vector2
  cx: number
  cy: number
  width: number
  height: number
  span: THREE.Vector2
}

/**
 * The Julia set of `fractal.julia`, in the same palette as the Mandelbrot plane. Fixed view,
 * float iteration up to 600 steps. Follows `fractal.julia` every frame (compared by value) and
 * only recomputes when it moves; never re-renders React.
 */
export function JuliaPlane({ width, height, quality = 1 }: JuliaPlaneProps) {
  const gl = useThree((s) => s.gl)
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const size = useRef({ width, height })
  size.current.width = width
  size.current.height = height
  const qualityRef = useRef<Quality>(quality)
  qualityRef.current = quality

  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    try {
      FractalSurface.check(gl)
    } catch (e) {
      console.error('[JuliaPlane]', e)
      return
    }
    const c = new THREE.Vector2()
    const surface = new FractalSurface({
      name: 'Julia',
      fragmentShader: juliaIterationFrag,
      uniforms: { uC: { value: c } },
    })
    const next: Rig = { surface, c, cx: NaN, cy: NaN, width: 0, height: 0, span: new THREE.Vector2(1, 1) }
    const canvas = gl.domElement
    const onRestored = () => surface.invalidate()
    canvas.addEventListener('webglcontextrestored', onRestored)
    rigRef.current = next
    setRig(next)
    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      surface.dispose()
      setRig(null)
    }
  }, [gl])

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
    const { julia } = useStore.getState().fractal
    const { width: w, height: h } = size.current
    let changed = false
    if (julia.cx !== r.cx || julia.cy !== r.cy) {
      r.cx = julia.cx
      r.cy = julia.cy
      r.c.set(julia.cx, julia.cy)
      changed = true
    }
    if (w !== r.width || h !== r.height) {
      r.width = w
      r.height = h
      r.span.set(JULIA_SPAN, (JULIA_SPAN * h) / w)
      changed = true
    }
    r.surface.prepare(changed, r.span, qualityRef.current, delta, state.clock.elapsedTime)
  })

  if (!rig) return null
  return <mesh ref={meshRef} geometry={geometry} material={rig.surface.material} />
}
