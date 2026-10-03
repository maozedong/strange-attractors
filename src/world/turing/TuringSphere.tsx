import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { DEFAULT_TURING } from '../../fractal/types'
import { useStore } from '../../store'
import { worldTele } from '../telemetry'
import { GLIDE_STEPS, glideDials, snapDials, type Dials } from './glide'
import { coatFrag, coatVert } from './shaders'
import { TuringSim } from './TuringSim'

/**
 * Turing's reaction–diffusion (Gray–Scott: U + 2V → 3V, V → P) running on a sphere, so the
 * pattern reads as an animal's coat. The state lives on the GPU (TuringSim, scheme in grid.ts);
 * this draws it as a lit, slowly turning ball centred at the group origin, pole up (+Y).
 *
 * Driven by `turing` in the store, read every frame (never re-renders per frame): `feed` and
 * `kill` set the reaction, `running` false stops the steps (the ball keeps turning), and a
 * `resetSerial` change starts again from the seeds. Adds the steps taken to
 * `worldTele.turingSteps`, which a reset sets back to 0.
 *
 * The dials glide. The simulation follows `feed` and `kill` through a critically damped spring
 * with a time constant of `glide` steps (glide.ts; ≈ 0.35 s at the default speed), so a preset button
 * behaves like the chapter's eased tweens. Gray–Scott needs this: an instant jump out of the
 * holes regime collapses the whole coat to bare skin in under a second (the uniform V-rich
 * state it rests on stops existing), while the same change eased over ~1 s reorganises it into
 * the new pattern. The spring runs in simulation time (it waits while frozen) and snaps on reset,
 * so the seeds always grow under the current dials.
 *
 * Lit by its own fixed key light in view space (the scene has no lights) and kept at most ~0.9
 * linear, so only the brightest marks touch the main bloom. Draws nothing, and logs why, if the
 * GPU cannot render to float textures.
 */
export interface TuringSphereProps {
  /** world radius. Default 1.3 */
  radius?: number
  /**
   * Gray–Scott steps per 60 Hz frame (0..24, default 12): 720 steps per second at any refresh
   * rate. At most 24 run in one frame; below 30 fps (at 12) the clock slows rather than bursting.
   */
  speed?: number
  /** turn rate about +Y, rad/s. Default 0.08 */
  spin?: number
  /** time constant, in steps, of the glide toward new feed / kill values; 0 applies them at once. Default GLIDE_STEPS (250) */
  glide?: number
}

const REFERENCE_HZ = 60
const MAX_STEPS_PER_FRAME = 24
const TAU = 2 * Math.PI
/** toward the key light in view space: upper left, in front */
const KEY_DIR = new THREE.Vector3(-0.5, 0.62, 0.6).normalize()
const noRaycast = () => {}

interface Rig extends Dials {
  sim: TuringSim
  material: THREE.ShaderMaterial
  /** the resetSerial the state was last seeded for */
  resetSerial: number
  /** fractional steps carried to the next frame (< 1) */
  owed: number
  /** set by `webglcontextrestored`: the state targets were wiped, reseed on the next frame */
  restored: boolean
}

export function TuringSphere({ radius = 1.3, speed = 12, spin = 0.08, glide = GLIDE_STEPS }: TuringSphereProps) {
  const gl = useThree((s) => s.gl)
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ speed, spin, glide })
  live.current.speed = speed
  live.current.spin = spin
  live.current.glide = glide

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 96, 64), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    let sim: TuringSim
    try {
      sim = new TuringSim(gl)
    } catch (e) {
      console.error('[TuringSphere] GPU simulation unavailable:', e instanceof Error ? e.message : e)
      return
    }
    sim.reset()
    worldTele.turingSteps = 0
    const material = new THREE.ShaderMaterial({
      name: 'TuringSphere.coat',
      vertexShader: coatVert,
      fragmentShader: coatFrag,
      uniforms: {
        uState: { value: sim.texture },
        uRows: { value: sim.rowTexture },
        uKey: { value: KEY_DIR.clone() },
      },
      toneMapped: false,
    })
    const t = useStore.getState().turing
    const next: Rig = {
      sim,
      material,
      resetSerial: t.resetSerial,
      owed: 0,
      restored: false,
      f: rate(t.feed, DEFAULT_TURING.feed),
      k: rate(t.kill, DEFAULT_TURING.kill),
      vf: 0,
      vk: 0,
    }
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
      material.dispose()
      sim.dispose()
      setRig(null)
    }
  }, [gl])

  useFrame((_, delta) => {
    const r = rigRef.current
    if (!r) return
    const dt = Math.min(Math.max(delta, 0), 0.1)
    const { feed, kill, running, resetSerial } = useStore.getState().turing
    const targetF = rate(feed, DEFAULT_TURING.feed)
    const targetK = rate(kill, DEFAULT_TURING.kill)

    if (r.restored || resetSerial !== r.resetSerial) {
      r.restored = false
      r.resetSerial = resetSerial
      r.sim.reset()
      r.owed = 0
      worldTele.turingSteps = 0
      // a fresh coat grows under the dials as they are now
      snapDials(r, targetF, targetK)
    }

    let steps = 0
    if (running) {
      const perFrame = Math.min(MAX_STEPS_PER_FRAME, Math.max(0, live.current.speed || 0))
      r.owed += dt * REFERENCE_HZ * perFrame
      steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(r.owed))
      // never carry more than a fraction: a slow frame slows the clock instead of bursting later
      r.owed = Math.min(r.owed - steps, 0.999)
    } else {
      r.owed = 0
    }
    if (steps > 0) {
      glideDials(r, targetF, targetK, steps, live.current.glide)
      r.sim.step(steps, r.f, r.k)
      worldTele.turingSteps += steps
    }
    r.material.uniforms.uState.value = r.sim.texture

    const mesh = meshRef.current
    if (mesh) mesh.rotation.y = (mesh.rotation.y + (live.current.spin || 0) * dt) % TAU
  })

  if (!rig) return null
  return <mesh ref={meshRef} geometry={geometry} material={rig.material} scale={radius} raycast={noRaycast} />
}

/** a finite rate in the range the model is meaningful for, else the default */
function rate(x: number, fallback: number): number {
  return Number.isFinite(x) ? Math.min(0.1, Math.max(0, x)) : fallback
}
