import { useStore } from '../../store'

/**
 * Does the Julia set of c hang together? c inside the Mandelbrot set ⇔ connected. Points
 * just outside escape slowly and give sets that are dust in theory but look whole on screen.
 */
function escapeAfter(cx: number, cy: number): number {
  let x = 0
  let y = 0
  for (let i = 0; i < 3000; i++) {
    const nx = x * x - y * y + cx
    const ny = 2 * x * y + cy
    x = nx
    y = ny
    if (x * x + y * y > 4) return i
  }
  return Infinity
}

function describe(n: number): string {
  if (n === Infinity) return 'inside the set: one piece'
  if (n > 60) return 'just outside: dust so fine it looks whole'
  return 'outside the set: dust'
}

export function JuliaInstrument() {
  const c = useStore((s) => s.fractal.julia)
  const pickable = useStore((s) => s.fractal.juliaPickable)
  const n = escapeAfter(c.cx, c.cy)
  return (
    <>
      <div className="row">
        <span className="label">c</span>
        <span className="readout">
          {c.cx.toFixed(3)} {c.cy < 0 ? '−' : '+'} {Math.abs(c.cy).toFixed(3)}i
        </span>
        <span className="label">{describe(n)}</span>
      </div>
      <p className="dial__state">
        {pickable ? 'Drag on the left picture to move c; the right one follows.' : 'Watch the right picture change as c drifts.'}
      </p>
    </>
  )
}
