import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { fixed } from '../format'
import { cameraDirector } from '../../scene/cameraDirector'
import { WORLD_LAYOUT } from '../../scene/layouts'
import { hyperionFollow } from '../../content/chapters'

const SPEEDS = [0.05, 0.1, 0.3]

export function HyperionInstrument() {
  const h = useStore((s) => s.hyperion)
  const setHyperion = useStore((s) => s.setHyperion)
  useTelemetry(8)
  return (
    <>
      <div className="row">
        <button className="action" onClick={() => setHyperion({ running: !h.running })}>
          {h.running ? 'Hold still' : 'Let it tumble'}
        </button>
        <button className="textbtn" onClick={() => setHyperion({ running: false, resetSerial: h.resetSerial + 1 })}>
          Start over
        </button>
        <label className="toggle">
          <input type="checkbox" checked={h.twin} onChange={(e) => setHyperion({ twin: e.target.checked })} />
          Show the copy
        </label>
      </div>
      <div className="row">
        <span className="label">Camera</span>
        <div className="choice" role="group" aria-label="Camera">
          <button onClick={() => cameraDirector.goTo(WORLD_LAYOUT.hyperionPose, 2)}>Saturn</button>
          <button onClick={() => cameraDirector.followTarget(hyperionFollow(h.twin, WORLD_LAYOUT.hyperionFollowWide), 2)}>
            ride with the moons
          </button>
        </div>
      </div>
      <div className="row">
        <span className="label">Orbits per second</span>
        <div className="choice" role="group" aria-label="Orbits per second">
          {SPEEDS.map((v) => (
            <button key={v} aria-pressed={h.speed === v} onClick={() => setHyperion({ speed: v })}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Days</span>
        <span className="readout">{fixed(worldTele.hyperionDays, 0)}</span>
        <span className="label">Orbits</span>
        <span className="readout">{fixed(worldTele.hyperionOrbits, 1)}</span>
        <span className="label">The two face apart by</span>
        <span className="readout">{Number.isFinite(worldTele.hyperionTwinAngle) ? `${fixed(worldTele.hyperionTwinAngle, 1)}°` : '—'}</span>
      </div>
    </>
  )
}
