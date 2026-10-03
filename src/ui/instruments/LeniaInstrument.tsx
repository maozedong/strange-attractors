import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { LENIA_SPECIES } from '../../world/lenia'
import { fixed } from '../format'

export function LeniaInstrument() {
  const l = useStore((s) => s.lenia)
  const setLenia = useStore((s) => s.setLenia)
  useTelemetry(6)
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="Species">
          {LENIA_SPECIES.map((sp) => (
            <button key={sp.id} aria-pressed={l.species === sp.id} onClick={() => setLenia({ species: sp.id, resetSerial: l.resetSerial + 1 })}>
              {sp.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Generations per second</span>
        <div className="choice" role="group" aria-label="Speed">
          {[3, 10, 30].map((v) => (
            <button key={v} aria-pressed={l.speed === v} onClick={() => setLenia({ speed: v })}>
              {v}
            </button>
          ))}
        </div>
        <button className="textbtn" onClick={() => setLenia({ resetSerial: l.resetSerial + 1 })}>
          Hatch them again
        </button>
      </div>
      <div className="row">
        <span className="label">Generation</span>
        <span className="readout">{fixed(worldTele.leniaGeneration, 0)}</span>
        <span className="label">Creatures</span>
        <span className="readout">{worldTele.leniaBlobs}</span>
        <span className="label">Mass</span>
        <span className="readout">{fixed(worldTele.leniaMass, 0)}</span>
      </div>
    </>
  )
}
