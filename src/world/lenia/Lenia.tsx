import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { worldTele } from '../telemetry'
import { LeniaSim } from './sim'
import { createDisplayMaterial } from './display'
import { getSpecies } from './species'

const INK = '#efe8dc'
const BORDER_OPACITY = 0.25
/** At most this many generations per frame (each is a 256² × 729-tap pass). */
const MAX_STEPS_PER_FRAME = 2
/** A frame longer than this (tab switch, hitch) is counted as this long. */
const MAX_DT = 0.25
/** Telemetry readback cadence, frames. */
const STATS_EVERY = 10

const noRaycast = () => {}

/** Set when the GPU cannot run the stage (the component then renders nothing). */
export const leniaStatus = { error: null as Error | null }

export interface LeniaProps {
  /** Edge of the square dish in render units, centred on the group origin in its XY plane,
   *  facing +Z. Default 3 */
  size?: number
  /** 0..1 fade for the dish, its creatures and its border. Default 1 */
  opacity?: number
}

interface Rig {
  sim: LeniaSim
  material: THREE.ShaderMaterial
  opacity: { value: number }
  /** species and resetSerial last acted on */
  speciesId: string | null
  resetSerial: number
  /** whole generations since the last seed */
  generation: number
  /** fraction of a generation owed, [0, 1) */
  acc: number
  /** display blend last presented (NaN = must present) */
  presented: number
  /** frames until the next telemetry readback may start */
  statsIn: number
  /** WebGL context was restored: GPU contents are gone, seed again */
  restored: boolean
  ready: boolean
}

/**
 * Lenia (Chan 2019): a continuous Game of Life on a 256² torus, run on the GPU, showing the
 * species `lenia.species` from LENIA_SPECIES. Follows `lenia` in the store every frame without
 * re-rendering: `speed` generations per real second (at most 2 per frame; a capped backlog is
 * dropped, not carried), `running` false freezes it, a `resetSerial` bump or species change
 * clears the dish and places the species' pattern at the three SEED_LAYOUT spots (one in the
 * centre, two offset and turned 90°; placed so three Orbia first meet after ≈ 1400
 * generations). The picture blends the previous generation toward the current one by the
 * clock's fraction of a generation, so creatures glide smoothly even at a few generations per
 * second.
 *
 * Telemetry: worldTele.leniaGeneration (fractional, matches the picture) every frame;
 * leniaMass (ΣA) and leniaBlobs (8-connected components of 8 × 8 blocks with mean A > 0.1,
 * periodic) from an asynchronous 32² readback every 10 frames.
 */
export function Lenia({ size = 3, opacity = 1 }: LeniaProps) {
  const gl = useThree((s) => s.gl)
  const [rig, setRig] = useState<Rig | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const groupRef = useRef<THREE.Group>(null)

  const geometry = useMemo(() => new THREE.PlaneGeometry(size, size), [size])
  useEffect(() => () => geometry.dispose(), [geometry])
  const border = useMemo<[number, number, number][]>(() => {
    const h = size / 2
    return [
      [-h, -h, 0],
      [h, -h, 0],
      [h, h, 0],
      [-h, h, 0],
      [-h, -h, 0],
    ]
  }, [size])

  useEffect(() => {
    let sim: LeniaSim
    try {
      sim = new LeniaSim(gl)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      leniaStatus.error = err
      console.error('[Lenia] GPU simulation unavailable:', err)
      return
    }
    leniaStatus.error = null

    const opacityUniform = { value: 1 }
    const material = createDisplayMaterial(sim, opacityUniform)

    const next: Rig = {
      sim,
      material,
      opacity: opacityUniform,
      speciesId: null,
      resetSerial: useStore.getState().lenia.resetSerial,
      generation: 0,
      acc: 0,
      presented: Number.NaN,
      statsIn: 0,
      restored: false,
      ready: false,
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

  useEffect(() => {
    if (rig) rig.opacity.value = Math.max(0, Math.min(1, opacity))
  }, [rig, opacity])

  useFrame((_, delta) => {
    const r = rigRef.current
    if (!r) return
    const { species: id, running, resetSerial, speed } = useStore.getState().lenia
    const sim = r.sim

    let reset = r.restored || resetSerial !== r.resetSerial
    if (id !== r.speciesId) {
      const sp = getSpecies(id)
      sim.setSpecies(sp)
      r.speciesId = id
      reset = true
    }
    if (reset) {
      sim.seed(getSpecies(id))
      r.resetSerial = resetSerial
      r.restored = false
      r.generation = 0
      r.acc = 0
      r.presented = Number.NaN
      r.statsIn = STATS_EVERY // the seed's stats are computed on the CPU by seed()
    }

    // the clock: `speed` generations per second, whole ones stepped, the fraction blended
    let n = 0
    if (running && !reset) {
      const rate = speed > 0 && Number.isFinite(speed) ? speed : 0
      r.acc += rate * Math.min(Math.max(delta, 0), MAX_DT)
      const whole = Math.floor(r.acc)
      n = Math.min(whole, MAX_STEPS_PER_FRAME)
      r.acc -= whole
    }
    if (n > 0) {
      sim.step(n)
      r.generation += n
    }

    // before the first step both targets hold the seed, so any blend shows generation 0
    const mix = r.generation > 0 ? r.acc : 0
    if (n > 0 || mix !== r.presented) {
      sim.present(mix)
      r.presented = mix
    }
    worldTele.leniaGeneration = r.generation > 0 ? r.generation - 1 + r.acc : 0

    // at most one readback per STATS_EVERY frames, and only of a changed field
    if (--r.statsIn <= 0 && sim.sampleStats()) r.statsIn = STATS_EVERY
    worldTele.leniaMass = sim.stats.mass
    worldTele.leniaBlobs = sim.stats.blobs

    if (!r.ready) {
      r.ready = true
      if (groupRef.current) groupRef.current.visible = true
    }
  })

  if (!rig) return null
  const fade = Math.max(0, Math.min(1, opacity))
  // a fully faded dish is not drawn; the simulation keeps running underneath
  return (
    <group ref={groupRef} visible={rig.ready}>
      <mesh geometry={geometry} material={rig.material} raycast={noRaycast} visible={fade > 0} />
      <Line
        points={border}
        color={INK}
        lineWidth={1}
        transparent
        opacity={BORDER_OPACITY * fade}
        depthWrite={false}
        depthTest={false}
        renderOrder={1}
        raycast={noRaycast}
        visible={fade > 0}
      />
    </group>
  )
}
