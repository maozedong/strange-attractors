import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { useStore } from '../store'
import { getSystem } from '../systems'
import { tele } from './telemetry'

/** Max integration steps per frame; protects slow GPUs when the tab stutters */
const MAX_STEPS = 32
/** Hard cap on queued (fast-forward) steps honoured in one frame */
const MAX_BURST = 4096

/**
 * Decides, once per frame and before anything else, how many integration steps the
 * swarm and the trajectory lines should take so they stay in lockstep.
 * Mount exactly once inside the Canvas.
 */
export function SimClock() {
  const carryRef = useRef(0)
  useFrame((_, delta) => {
    let carry = carryRef.current
    const { speed, paused, systemId } = useStore.getState()
    const sys = getSystem(systemId)
    tele.dt = sys.dt
    tele.fps += (1 / Math.max(delta, 1e-3) - tele.fps) * 0.05
    const burst = Math.min(tele.queuedSteps, tele.burstPerFrame, MAX_BURST)
    tele.queuedSteps -= burst
    if (paused) {
      tele.stepsThisFrame = burst
      tele.simTime += burst * sys.dt
      return
    }
    const frameDt = Math.min(delta, 1 / 20)
    const wanted = (sys.rate * speed * frameDt) / sys.dt + carry
    const steps = Math.min(MAX_STEPS, Math.floor(wanted))
    carry = Math.min(wanted - steps, 4)
    carryRef.current = carry
    tele.stepsThisFrame = steps + burst
    tele.simTime += (steps + burst) * sys.dt
  }, -100)
  return null
}
