import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { useStore } from '../store'
import { getSystem } from '../systems'
import { TrajectoryEngine } from './trajectories/TrajectoryEngine'

export interface TrajectoriesProps {
  /** [trajectory 0, trajectory 1]; any colour string THREE.Color accepts */
  colors?: [string, string]
  /** line width in CSS pixels */
  linewidth?: number
}

const DEFAULT_COLORS: [string, string] = ['#9fe3ff', '#ffb07a']

/**
 * One or two CPU-integrated (double precision RK4) trajectories of the current attractor,
 * stepped in lockstep with the GPU swarm and drawn as additive fat lines with a glowing head.
 * Driven by `trajQueue` commands (start / clear). Mount once inside the Canvas, after SimClock.
 * Head positions for camera rigs: `getTrajectoryHeads()` from './trajectories/heads'.
 */
export function Trajectories({ colors = DEFAULT_COLORS, linewidth = 1.6 }: TrajectoriesProps) {
  const groupRef = useRef<Group>(null)
  const engineRef = useRef<TrajectoryEngine | null>(null)
  const trajVisible = useStore((s) => s.trajVisible)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)
  const [colorA, colorB] = colors

  // Created in an effect (not during render) so StrictMode / Fast Refresh remounts get a fresh,
  // undisposed engine. The effects below run after this one in the same commit.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const engine = new TrajectoryEngine()
    group.add(engine.root)
    engineRef.current = engine
    return () => {
      group.remove(engine.root)
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => engineRef.current?.setColors(colorA, colorB), [colorA, colorB])
  useEffect(() => engineRef.current?.setLinewidth(linewidth), [linewidth])
  useEffect(() => engineRef.current?.setResolution(width, height), [width, height])
  useEffect(() => engineRef.current?.setPixelRatio(dpr), [dpr])

  useFrame(() => {
    const engine = engineRef.current
    if (!engine) return
    const st = useStore.getState()
    engine.update(st.drainTraj(), getSystem(st.systemId), st.params, st.trajVisible)
  }, 0)

  // rotation: the system's z axis points up on screen (the swarm does the same)
  return <group ref={groupRef} rotation-x={-Math.PI / 2} visible={trajVisible} />
}
