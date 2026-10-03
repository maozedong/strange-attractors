import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { loadBritain, RULERS, walkInfo } from '../fractal/coast'

const W = 320
const H = 190
const M = { top: 30, right: 14, bottom: 32, left: 50 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

/**
 * Richardson's plot: measured length against ruler length, both on log scales. A line
 * with a slope is the whole point: the length never settles, it follows a power law.
 */
export function RichardsonChart() {
  const ruler = useStore((s) => s.coast.ruler)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let on = true
    void loadBritain().then(() => on && setReady(true))
    return () => {
      on = false
    }
  }, [])
  if (!ready) return null
  const pts = RULERS.map((r) => ({ r, ...walkInfo(r) })).filter((p) => p.lengthKm > 0)
  if (pts.length < 2) return null
  const xs = pts.map((p) => Math.log10(p.r))
  const ys = pts.map((p) => Math.log10(p.lengthKm))
  const xMin = Math.min(...xs) - 0.1
  const xMax = Math.max(...xs) + 0.1
  const yMin = Math.min(...ys) - 0.05
  const yMax = Math.max(...ys) + 0.05
  const sx = (x: number) => M.left + ((x - xMin) / (xMax - xMin)) * PW
  const sy = (y: number) => M.top + (1 - (y - yMin) / (yMax - yMin)) * PH
  // least squares fit: log L = a + b log r, dimension D = 1 − b
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const b = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / xs.reduce((acc, x) => acc + (x - mx) ** 2, 0)
  const a = my - b * mx
  const D = 1 - b
  const shown = pts.filter((p) => p.r >= ruler || ruler === 0)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Measured coastline length against ruler length; the slope gives a dimension of ${D.toFixed(2)}.`}>
      <text className="chart__title" x={M.left} y={14}>
        The shorter the ruler, the longer the coast
      </text>
      {[2000, 3000, 4000, 6000]
        .map((v) => Math.log10(v))
        .filter((e) => e > yMin && e < yMax)
        .map((e) => (
          <g key={e}>
            <line className="chart__grid" x1={M.left} x2={W - M.right} y1={sy(e)} y2={sy(e)} />
            <text x={M.left - 8} y={sy(e) + 4} textAnchor="end">
              {Math.round(10 ** e).toLocaleString('en-US')}
            </text>
          </g>
        ))}
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={M.top + PH} y2={M.top + PH} />
      {pts.map((p) => (
        <text key={p.r} x={sx(Math.log10(p.r))} y={H - 12} textAnchor="middle">
          {p.r}
        </text>
      ))}
      <text x={M.left} y={H - 1} fontSize="11">
        ruler, km
      </text>
      <path className="chart__ref" d={`M${sx(xMin)},${sy(a + b * xMin)}L${sx(xMax)},${sy(a + b * xMax)}`} />
      <text x={sx(xMin) + 10} y={sy(a + b * xMin) + 16} fontSize="11">
        dimension {D.toFixed(2)}
      </text>
      {shown.map((p) => (
        <circle
          key={p.r}
          cx={sx(Math.log10(p.r))}
          cy={sy(Math.log10(p.lengthKm))}
          r={p.r === ruler ? 4.5 : 3}
          fill={p.r === ruler ? 'var(--twin-b)' : 'var(--ink)'}
        />
      ))}
    </svg>
  )
}
