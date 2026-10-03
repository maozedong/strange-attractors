import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { fixed } from '../format'

const SPEEDS = [0.5, 1, 3]

export function ForecastInstrument() {
  const f = useStore((s) => s.forecast)
  const setForecast = useStore((s) => s.setForecast)
  useTelemetry(8)
  return (
    <>
      <div className="row">
        {f.running ? (
          <button className="action" onClick={() => setForecast({ running: false, resetSerial: f.resetSerial + 1 })}>
            Start a new forecast
          </button>
        ) : (
          <button className="action" onClick={() => setForecast({ running: true })}>
            Run the forecast
          </button>
        )}
        <span className="label">Days per second</span>
        <div className="choice" role="group" aria-label="Days per second">
          {SPEEDS.map((v) => (
            <button key={v} aria-pressed={f.speed === v} onClick={() => setForecast({ speed: v })}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Day</span>
        <span className="readout">{fixed(worldTele.forecastDay, 1)}</span>
        <span className="label">Spread</span>
        <span className="readout">{fixed(worldTele.forecastSpread, 2)}</span>
        <span className="label">Error of the average</span>
        <span className="readout">{fixed(worldTele.forecastError, 2)}</span>
      </div>
    </>
  )
}
