import { useStore } from '../../store'
import { startTwins } from '../../content/chapters'
import { useTelemetry } from '../useTelemetry'
import { pow10, sci } from '../format'

const NUDGES = [1e-3, 1e-6, 1e-9, 1e-12]

export function TwinsInstrument() {
  const nudge = useStore((s) => s.twinNudge)
  const t = useTelemetry(8)
  const restart = (n: number) => startTwins(useStore.getState(), n)
  return (
    <>
      <div className="row">
        <span className="label">Starting gap</span>
        <div className="choice" role="group" aria-label="Starting gap">
          {NUDGES.map((n) => (
            <button key={n} aria-pressed={n === nudge} onClick={() => restart(n)}>
              {pow10(Math.round(Math.log10(n)))}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Gap now</span>
        <span className="readout" aria-live="off">
          {sci(t.twinSep)}
        </span>
        <button className="textbtn" onClick={() => restart(nudge)}>
          Restart the twins
        </button>
      </div>
    </>
  )
}
