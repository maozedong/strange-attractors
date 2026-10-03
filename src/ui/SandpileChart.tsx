import { useTelemetry } from './useTelemetry'
import { worldTele } from '../world/telemetry'

const W = 320
const H = 180
const M = { top: 30, right: 14, bottom: 32, left: 44 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom
const BINS = 20

/**
 * How many avalanches of each size: both axes logarithmic. A straight line is the point:
 * there is no typical size, only a power law.
 */
export function SandpileChart() {
  useTelemetry(6)
  const raw = worldTele.sandHistogram
  let total = 0
  for (let i = 0; i < BINS; i++) total += raw[i]
  if (total < 50) return null
  // avalanches per unit of size (count ÷ bin width): a power law is then a straight line
  const h = Array.from({ length: BINS }, (_, i) => raw[i] / 2 ** i)
  const yMax = Math.log10(Math.max(10, ...h))
  const sx = (i: number) => M.left + (i / BINS) * PW
  const sy = (c: number) => M.top + (1 - Math.log10(Math.max(1, c)) / yMax) * PH
  const bw = PW / BINS - 2
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Avalanche sizes on logarithmic axes">
      <text className="chart__title" x={M.left} y={14}>
        How many avalanches of each size
      </text>
      {[0, 1, 2, 3, 4, 5].filter((e) => e <= yMax).map((e) => (
        <g key={e}>
          <line className="chart__grid" x1={M.left} x2={W - M.right} y1={sy(10 ** e)} y2={sy(10 ** e)} />
          <text x={M.left - 8} y={sy(10 ** e) + 4} textAnchor="end">
            {(10 ** e).toLocaleString('en-US')}
          </text>
        </g>
      ))}
      <text x={M.left} y={M.top - 6} fontSize="11" style={{ fill: 'var(--ink-3)' }}>
        per unit of size, so a power law is a straight line
      </text>
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={M.top + PH} y2={M.top + PH} />
      {Array.from({ length: BINS }, (_, i) => (
        <rect key={i} x={sx(i) + 1} y={sy(h[i])} width={bw} height={Math.max(0, M.top + PH - sy(h[i]))} fill="var(--ink-2)" rx={2} />
      ))}
      {[0, 4, 8, 12, 16].map((i) => (
        <text key={i} x={sx(i) + bw / 2 + 1} y={H - 12} textAnchor="middle">
          {(2 ** i).toLocaleString('en-US')}
        </text>
      ))}
      <text x={M.left} y={H - 1} fontSize="11">
        topplings per avalanche
      </text>
    </svg>
  )
}
