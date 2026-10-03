import { useStore } from '../../store'
import { director } from '../../director/director'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { criticalCoupling } from '../../world/fireflies'

export function FirefliesInstrument() {
  const f = useStore((s) => s.fireflies)
  const setFireflies = useStore((s) => s.setFireflies)
  useTelemetry(6)
  const kc = criticalCoupling()
  return (
    <>
      <div className="slider">
        <span className="slider__sym">coupling</span>
        <div className="dial__track">
          <input
            type="range"
            min={0}
            max={3}
            step={0.01}
            value={f.coupling}
            aria-label="Coupling strength"
            onChange={(e) => {
              director.cancel('coupling')
              setFireflies({ coupling: Number(e.target.value) })
            }}
          />
          <div className="dial__marks" aria-hidden="true">
            <button className="dial__mark" style={{ left: `${(kc / 3) * 100}%`, top: 6 }} tabIndex={-1} onClick={() => setFireflies({ coupling: kc })}>
              they start to lock
            </button>
          </div>
        </div>
        <span className="slider__val">{f.coupling.toFixed(2)}</span>
      </div>
      <div className="row">
        <span className="label">In step</span>
        <span className="readout">{Math.round(worldTele.firefliesOrder * 100)}%</span>
        <button className="textbtn" onClick={() => setFireflies({ resetSerial: f.resetSerial + 1 })}>
          Scramble their clocks
        </button>
      </div>
    </>
  )
}
