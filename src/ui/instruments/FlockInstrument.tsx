import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { int } from '../format'
import type { FlockState } from '../../fractal/types'

const RULES: { id: FlockState['rules']; label: string }[] = [
  { id: 'all', label: 'all three rules' },
  { id: 'noSeparation', label: 'no "don\'t crowd"' },
  { id: 'noAlignment', label: 'no "fly their way"' },
  { id: 'noCohesion', label: 'no "stay close"' },
]

export function FlockInstrument() {
  const f = useStore((s) => s.flock)
  const setFlock = useStore((s) => s.setFlock)
  useTelemetry(6)
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="Rules">
          {RULES.map((r) => (
            <button key={r.id} aria-pressed={f.rules === r.id} onClick={() => setFlock({ rules: r.id })}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <label className="toggle">
          <input type="checkbox" checked={f.hawk} onChange={(e) => setFlock({ hawk: e.target.checked })} />
          Send in a hawk
        </label>
        <span className="label">Birds</span>
        <div className="choice" role="group" aria-label="Birds">
          {[2000, 10000, 20000].map((n) => (
            <button key={n} aria-pressed={f.count === n} onClick={() => setFlock({ count: n })}>
              {int(n)}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Flying the same way</span>
        <span className="readout">{Math.round(worldTele.flockAlignment * 100)}%</span>
        <button className="textbtn" onClick={() => setFlock({ resetSerial: f.resetSerial + 1 })}>
          Scatter them
        </button>
      </div>
    </>
  )
}
