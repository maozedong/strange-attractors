import { PERIOD_DOUBLINGS, FEIGENBAUM_DELTA } from '../../fractal/logistic'

/** The first doublings and the ratio of successive gaps, converging on δ. */
export function FeigenbaumTable() {
  const rows = PERIOD_DOUBLINGS.slice(0, 5).map((r, i) => {
    const prev = PERIOD_DOUBLINGS[i - 1]
    const next = PERIOD_DOUBLINGS[i + 1]
    const ratio = prev !== undefined && next !== undefined ? (r - prev) / (next - r) : null
    return { period: 2 ** (i + 1), r, ratio }
  })
  return (
    <table className="table">
      <thead>
        <tr>
          <th>period</th>
          <th>splits at r</th>
          <th>gap ratio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.period}>
            <td>{row.period}</td>
            <td>{row.r.toFixed(4)}</td>
            <td>{row.ratio === null ? '' : row.ratio.toFixed(3)}</td>
          </tr>
        ))}
        <tr className="table__limit">
          <td>∞</td>
          <td>3.5699</td>
          <td>{FEIGENBAUM_DELTA.toFixed(3)}…</td>
        </tr>
      </tbody>
    </table>
  )
}
