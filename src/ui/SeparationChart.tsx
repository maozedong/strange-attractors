import { useMemo, useState } from 'react'
import { useTelemetry } from './useTelemetry'

/** largest Lyapunov exponent of the Lorenz system at σ=10, ρ=28, β=8/3 */
const LAMBDA = 0.9056
/** typical distance between two unrelated points on the attractor */
const SATURATION = 25

const W = 320
const H = 190
const M = { top: 30, right: 14, bottom: 30, left: 44 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

/**
 * How far apart the twins are, on a log scale, against time. One series, so no
 * legend; the dashed reference is the exponential law with a direct label.
 */
export function SeparationChart() {
  const t = useTelemetry(12)
  const [hover, setHover] = useState<number | null>(null)
  const n = t.sepCount

  const { xMax, yMin, path, ref, refLabel, d0 } = useMemo(() => {
    const d0 = n > 0 ? t.sepD[0] : 1e-6
    const tEnd = n > 0 ? t.sepT[n - 1] : 0
    const xMax = Math.max(20, Math.ceil(tEnd / 10) * 10)
    const yMin = Math.floor(Math.log10(Math.max(d0, 1e-16))) - 0.5
    const yMax = 2
    const sx = (x: number) => M.left + (x / xMax) * PW
    const sy = (y: number) => M.top + (1 - (y - yMin) / (yMax - yMin)) * PH
    let path = ''
    const step = Math.max(1, Math.floor(n / 600))
    for (let i = 0; i < n; i += step) {
      const y = Math.log10(Math.max(t.sepD[i], 1e-16))
      path += `${i === 0 ? 'M' : 'L'}${sx(t.sepT[i]).toFixed(1)},${sy(Math.min(y, yMax)).toFixed(1)}`
    }
    // reference: d(t) = d0 e^{λt}, drawn until it hits the saturation level
    const yRefEnd = Math.log10(SATURATION)
    const tHit = Math.min(xMax, ((yRefEnd - Math.log10(d0)) * Math.LN10) / LAMBDA)
    const ref = `M${sx(0).toFixed(1)},${sy(Math.log10(d0)).toFixed(1)}L${sx(tHit).toFixed(1)},${sy(yRefEnd).toFixed(1)}`
    // label sits beside the reference line a third of the way up, clear of the top gridline
    const tLabel = tHit * 0.38
    const refLabel = { x: sx(tLabel) + 8, y: sy(Math.log10(d0) + (LAMBDA * tLabel) / Math.LN10) + 4 }
    return { xMax, yMin, path, ref, refLabel, d0 }
  }, [n, t, t.sepCount])

  const sx = (x: number) => M.left + (x / xMax) * PW
  const sy = (y: number) => M.top + (1 - (y - yMin) / (2 - yMin)) * PH
  const yTicks: number[] = []
  for (let e = Math.ceil(yMin); e <= 2; e++) if ((e - 2) % 3 === 0) yTicks.push(e)
  const xTicks = [0, xMax / 2, xMax]

  // nearest sample for the hover cursor
  let hi = -1
  if (hover !== null && n > 0) {
    const tx = ((hover - M.left) / PW) * xMax
    let best = Infinity
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 800))) {
      const d = Math.abs(t.sepT[i] - tx)
      if (d < best) {
        best = d
        hi = i
      }
    }
  }

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Distance between the twins over time. Now ${t.twinSep.toExponential(1)} after ${t.simTime.toFixed(1)} time units.`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setHover(((e.clientX - r.left) / r.width) * W)
      }}
      onMouseLeave={() => setHover(null)}
    >
      <text className="chart__title" x={M.left} y={14}>
        How far apart the twins are
      </text>
      {yTicks.map((e) => (
        <g key={e}>
          <line className="chart__grid" x1={M.left} x2={W - M.right} y1={sy(e)} y2={sy(e)} />
          <text x={M.left - 8} y={sy(e) + 4} textAnchor="end">
            10
            <tspan baselineShift="super" fontSize="8">
              {e}
            </tspan>
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={M.left} x2={W - M.right} y1={M.top + PH} y2={M.top + PH} />
      {xTicks.map((x) => (
        <text key={x} x={sx(x)} y={H - 10} textAnchor="middle">
          {x}
        </text>
      ))}
      <text x={W - M.right} y={H - 10} textAnchor="end" dx={-28}>
        time
      </text>
      <path className="chart__ref" d={ref} />
      <text x={refLabel.x} y={refLabel.y} fontSize="11">
        doubling every 0.77
      </text>
      <path className="chart__series" d={path} />
      {hi >= 0 && (
        <g>
          <line className="chart__cursor" x1={sx(t.sepT[hi])} x2={sx(t.sepT[hi])} y1={M.top} y2={M.top + PH} />
          <circle cx={sx(t.sepT[hi])} cy={sy(Math.min(2, Math.log10(Math.max(t.sepD[hi], 1e-16))))} r={3} fill="var(--ink)" />
          <text
            className="chart__tip"
            x={sx(t.sepT[hi]) + (t.sepT[hi] > xMax * 0.6 ? -8 : 8)}
            y={M.top + 12}
            textAnchor={t.sepT[hi] > xMax * 0.6 ? 'end' : 'start'}
          >
            t {t.sepT[hi].toFixed(1)}, gap {t.sepD[hi].toExponential(1)}
          </text>
        </g>
      )}
      <title>Started {d0.toExponential(0)} apart</title>
    </svg>
  )
}
