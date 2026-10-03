import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import { useStore } from '../../store'
import { BulbRenderer } from './BulbRenderer'
import { BULB_RADIUS } from './de'
import { MAX_SCALE, MIN_SCALE } from './governor'
import { FILM } from '../../film/flag'
import { approachPower, type PowerTween } from './tween'

export interface MandelbulbProps {
  /**
   * World radius of the sphere around the classic power-8 bulb (default BULB_RADIUS = 1.25,
   * where one fractal unit is one world unit). Lower powers reach past it, to 1.42x at n = 2.
   */
  radius?: number
  /**
   * Ceiling on the internal resolution, as a fraction of the framebuffer per axis
   * (MIN_SCALE 0.35 .. 1, default 1). The resolution adapts below it to hold 60 fps.
   */
  maxScale?: number
}

/** the estimator and the bound table are measured for this range */
const MIN_POWER = 1.5
const MAX_POWER = 24

/**
 * The Mandelbulb (White & Nylander 2009), ray-marched against the scene camera, fixed at the
 * group origin with its pole up. Reads `bulb.power` from the store every frame and tweens to it;
 * never re-renders per frame. Draws nothing until its shaders have compiled (in parallel where
 * the browser can), so mounting it does not stall the page. See BulbRenderer for the passes and
 * governor.ts for the adaptive resolution.
 */
export function Mandelbulb({ radius = BULB_RADIUS, maxScale = MAX_SCALE }: MandelbulbProps) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const [rig, setRig] = useState<BulbRenderer | null>(null)
  const [ready, setReady] = useState(false)
  const rigRef = useRef<BulbRenderer | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const maxScaleRef = useRef(maxScale)
  maxScaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, maxScale))
  const power = useRef<PowerTween>({ x: NaN, v: 0 })
  const lastFrame = useRef(0)

  useEffect(() => {
    const why = BulbRenderer.unsupported(gl)
    if (why) {
      console.error('[Mandelbulb]', why)
      return
    }
    const next = new BulbRenderer()
    let alive = true
    next.compile(gl, get().camera).then(
      () => alive && setReady(true),
      (e: unknown) => {
        console.error('[Mandelbulb] shader compile', e)
        if (alive) setReady(true)
      },
    )
    const canvas = gl.domElement
    const onRestored = () => next.invalidate()
    canvas.addEventListener('webglcontextrestored', onRestored)
    rigRef.current = next
    setRig(next)
    return () => {
      alive = false
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (rigRef.current === next) rigRef.current = null
      next.dispose()
      setRig(null)
      setReady(false)
    }
  }, [gl, get])

  // the march runs as the mesh is drawn, with the camera actually in use
  useEffect(() => {
    const mesh = meshRef.current
    if (!rig || !mesh) return
    mesh.onBeforeRender = (renderer, _scene, camera) => rig.render(renderer, camera, mesh)
    return () => {
      mesh.onBeforeRender = () => {}
    }
  }, [rig])

  useFrame((_, delta) => {
    const r = rigRef.current
    if (!r) return
    const now = performance.now()
    // when recording frame by frame the wall clock is meaningless; report a steady 60 fps so
    // the governor renders at full resolution instead of chasing the screenshot time
    const interval = FILM ? 1000 / 60 : lastFrame.current > 0 ? now - lastFrame.current : 0
    lastFrame.current = now
    const want = useStore.getState().bulb.power
    const target = Number.isFinite(want) ? Math.min(MAX_POWER, Math.max(MIN_POWER, want)) : 8
    const p = power.current
    if (Number.isNaN(p.x)) p.x = target
    else approachPower(p, target, delta)
    r.prepare(p.x, delta, interval, maxScaleRef.current)
  })

  if (!rig) return null
  return (
    <mesh
      ref={meshRef}
      geometry={rig.geometry}
      material={rig.material}
      rotation-x={-Math.PI / 2}
      scale={radius / BULB_RADIUS}
      visible={ready}
    />
  )
}
