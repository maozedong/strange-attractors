import { useTelemetry } from './useTelemetry'
import { worldTele } from '../world/telemetry'
import { CLIMATE_SPREAD } from '../world/forecast'

const W = 320
const H = 190
const M = { top: 30, right: 14, bottom: 32, left: 40 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom
const DAYS = 21

/**
 * Ensemble spread and the error of the ensemble mean against the truth, by forecast day.
 * Two series, so a legend; the climate line and the two-week wall are labelled in place.
 */
export function ForecastChart() {
  const t = useTelemetry(10)
  const n = worldTele.forecastCount
  const yMax = CLIMATE_SPREAD * 1.6
  const sx = (d: number) => M.left + (Math.min(d, DAYS) / DAYS) * PW
  const sy = (v: number) => M.top + (1 - Math.min(v, yMax) / yMax) * PH
  let spread = ''
  let error = ''
  const step = Math.max(1, Math.floor(n / 400))
  for (let i = 0; i < n; i += step) {
    const d = worldTele.forecastT[i]
    if (d > DAYS) break
    spread += `${i === 0 ? 'M' : 'L'}${sx(d).toFixed(1)},${sy(worldTele.forecastS[i]).toFixed(1)}`
    error += `${i === 0 ? 'M' : 'L'}${sx(d).toFixed(1)},${sy(worldTele.forecastE[i]).toFixed(1)}`
  }
  void t
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Forecast spread by day. Day ${worldTele.forecastDay.toFixed(1)}, spread ${worldTele.forecastSpread.toFixed(2)}.`}>
      <text className="chart__title" x={M.left} y={14}>
        How far the copies disagree
      </text>
      {[0, 7, 14, 21].map((d) => (
        <g key={d}>
          <line className="chart__grid" x1={sx(d)} x2={sx(d)} y1={M.top} y2={M.top + PH} />
          <text x={sx(d)} y={H - 12} textAnchor="middle">
            {d === 0 ? 'day 0' : d}
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={M.top + PH} y2={M.top + PH} />
      <line className="chart__ref" x1={M.left} x2={W - M.right} y1={sy(CLIMATE_SPREAD)} y2={sy(CLIMATE_SPREAD)} />
      <text x={W - M.right} y={sy(CLIMATE_SPREAD) - 5} textAnchor="end" fontSize="11">
        as wide as the weather itself
      </text>
      <text x={sx(14) + 4} y={M.top + PH - 6} fontSize="11">
        two weeks
      </text>
      <path className="chart__series" d={spread} />
      <path className="chart__series" d={error} style={{ stroke: 'var(--twin-b)' }} />
      <g fontSize="11">
        <rect x={M.left + 4} y={M.top + 6} width={10} height={2} fill="var(--ink)" />
        <text x={M.left + 18} y={M.top + 10}>
          spread of the copies
        </text>
        <rect x={M.left + 4} y={M.top + 20} width={10} height={2} fill="var(--twin-b)" />
        <text x={M.left + 18} y={M.top + 24}>
          error of their average
        </text>
      </g>
    </svg>
  )
}
