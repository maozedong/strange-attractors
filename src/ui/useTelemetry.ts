import { useEffect, useState } from 'react'
import { tele } from '../sim/telemetry'

/** Re-render the caller `hz` times a second and hand back the live telemetry object. */
export function useTelemetry(hz = 10) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 1e9), 1000 / hz)
    return () => window.clearInterval(id)
  }, [hz])
  return tele
}
