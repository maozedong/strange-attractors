import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { lavaKey } from '../../world/taffy'
import { fixed } from '../format'

const SPEEDS = [0.25, 0.5, 1]

export function HoldInstrument() {
  const t = useStore((s) => s.taffy)
  const setTaffy = useStore((s) => s.setTaffy)
  useTelemetry(4)
  const key = lavaKey(Math.floor(Date.now() / 1000))
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="What to show">
          <button aria-pressed={!t.lamps} onClick={() => setTaffy({ lamps: false })}>
            the taffy puller
          </button>
          <button aria-pressed={t.lamps} onClick={() => setTaffy({ lamps: true })}>
            the lava lamps
          </button>
        </div>
      </div>
      {t.lamps ? (
        <div className="row">
          <span className="label">This second's key</span>
          <span className="readout readout--key">{key.slice(0, 32)}</span>
        </div>
      ) : (
        <>
          <div className="row">
            <button className="action" onClick={() => setTaffy({ running: !t.running })}>
              {t.running ? 'Stop pulling' : 'Pull'}
            </button>
            <button className="textbtn" onClick={() => setTaffy({ running: false, resetSerial: t.resetSerial + 1 })}>
              Fresh taffy
            </button>
            <span className="label">Pulls per second</span>
            <div className="choice" role="group" aria-label="Pulls per second">
              {SPEEDS.map((v) => (
                <button key={v} aria-pressed={t.speed === v} onClick={() => setTaffy({ speed: v })}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="label">Pulls so far</span>
            <span className="readout">{fixed(worldTele.taffyPulls, 1)}</span>
          </div>
        </>
      )}
    </>
  )
}
