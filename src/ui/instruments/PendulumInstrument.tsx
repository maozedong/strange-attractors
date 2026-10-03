import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { fixed, pow10 } from '../format'
import { pendulumNudge } from '../../content/chapters'

/** degrees between neighbouring copies */
const NUDGES = [1e-3, 1e-6, 1e-9]
const COUNTS = [10, 100, 200]

export function PendulumInstrument() {
  const p = useStore((s) => s.pendulum)
  const setPendulum = useStore((s) => s.setPendulum)
  useTelemetry(8)
  const reset = (patch: Partial<typeof p> = {}) => setPendulum({ ...patch, running: false, resetSerial: p.resetSerial + 1 })
  const count = p.count
  const degNow = NUDGES.find((d) => Math.abs(pendulumNudge(d, count) - p.nudge) < 1e-12) ?? null
  return (
    <>
      <div className="row">
        <span className="label">Copies</span>
        <div className="choice" role="group" aria-label="Copies">
          {COUNTS.map((n) => (
            <button key={n} aria-pressed={p.count === n} onClick={() => reset({ count: n, nudge: pendulumNudge(degNow ?? 1e-6, n) })}>
              {n}
            </button>
          ))}
        </div>
        <span className="label">Neighbours differ by</span>
        <div className="choice" role="group" aria-label="Degrees between neighbours">
          {NUDGES.map((n) => (
            <button key={n} aria-pressed={degNow === n} onClick={() => reset({ nudge: pendulumNudge(n, count) })}>
              {pow10(Math.round(Math.log10(n)))}°
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        {p.running ? (
          <button className="action" onClick={() => reset()}>
            Line them up again
          </button>
        ) : (
          <button className="action" onClick={() => setPendulum({ running: true })}>
            Let go
          </button>
        )}
      </div>
      <div className="row">
        <span className="label">Since release</span>
        <span className="readout">{fixed(worldTele.pendulumTime, 1)} s</span>
        <span className="label">How far apart the tips are</span>
        <span className="readout">{fixed(worldTele.pendulumSpread, 2)}</span>
      </div>
    </>
  )
}
