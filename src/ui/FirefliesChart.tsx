import { useTelemetry } from './useTelemetry'
import { worldTele } from '../world/telemetry'

const W = 320
const H = 170
const M = { top: 30, right: 14, bottom: 30, left: 40 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

/** The Kuramoto order parameter against time: 0 = every firefly on its own clock, 1 = one clock. */
export function FirefliesChart() {
  useTelemetry(10)
  const n = worldTele.firefliesCount
  const tEnd = n > 0 ? worldTele.firefliesT[n - 1] : 0
  const xMax = Math.max(30, Math.ceil(tEnd / 15) * 15)
  const sx = (t: number) => M.left + (t / xMax) * PW
  const sy = (r: number) => M.top + (1 - r) * PH
  let d = ''
  const step = Math.max(1, Math.floor(n / 500))
  for (let i = 0; i < n; i += step) d += `${i === 0 ? 'M' : 'L'}${sx(worldTele.firefliesT[i]).toFixed(1)},${sy(worldTele.firefliesR[i]).toFixed(1)}`
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How many fireflies flash in step: ${Math.round(worldTele.firefliesOrder * 100)} percent.`}>
      <text className="chart__title" x={M.left} y={14}>
        How much of the tree flashes together
      </text>
      {[0, 0.5, 1].map((r) => (
        <g key={r}>
          <line className="chart__grid" x1={M.left} x2={W - M.right} y1={sy(r)} y2={sy(r)} />
          <text x={M.left - 8} y={sy(r) + 4} textAnchor="end">
            {Math.round(r * 100)}%
          </text>
        </g>
      ))}
      {[0, xMax / 2, xMax].map((t) => (
        <text key={t} x={sx(t)} y={H - 10} textAnchor="middle">
          {t}
        </text>
      ))}
      <text x={W - M.right} y={H - 10} textAnchor="end" dx={-30}>
        seconds
      </text>
      <path className="chart__series" d={d} />
    </svg>
  )
}
