import { useStore } from '../../store'
import { director } from '../../director/director'

const RHO = 1 // index of ρ in the Lorenz params
const MAX = 170

/** The interesting part of the dial is below 30, so the track uses a square-root scale. */
const toPos = (rho: number) => Math.sqrt(Math.max(0, rho) / MAX)
const toRho = (pos: number) => MAX * pos * pos

const MARKS: { at: number; label: string; row?: number }[] = [
  { at: 1, label: 'the fluid stirs' },
  { at: 24.74, label: 'chaos' },
  { at: 28, label: "Lorenz's dial", row: 1 },
  { at: 100, label: 'order' },
  { at: 160, label: 'order again' },
]

function describe(rho: number): string {
  if (rho < 1) return 'Too cold to move. Every path sinks to the centre and stops.'
  if (rho < 13.93) return 'Two steady rolls. Every path settles into one eye or the other.'
  if (rho < 24.06) return 'Paths wander between the eyes for a while, then settle into one.'
  if (rho < 24.74) return 'Chaos and the steady rolls coexist. Where you start decides your fate.'
  if (rho >= 99.52 && rho <= 100.8) return 'A window of order. The path closes on itself and repeats.'
  if (rho >= 148 && rho <= 166) return 'Another window. One loop, then its doublings, hidden in the chaos.'
  return 'Chaos. The eyes are unstable and every path is thrown off them.'
}

export function HeatDial() {
  const rho = useStore((s) => s.params[RHO] ?? 28)
  const setParam = useStore((s) => s.setParam)
  return (
    <div className="dial">
      <div className="slider">
        <span className="slider__sym">ρ</span>
        <div className="dial__track">
          <input
            type="range"
            min={0}
            max={1}
            step={0.0005}
            value={toPos(rho)}
            aria-label="Heating, rho"
            aria-valuetext={rho.toFixed(2)}
            onChange={(e) => {
              director.cancel('rho')
              setParam(RHO, Math.round(toRho(Number(e.target.value)) * 100) / 100)
            }}
          />
          <div className="dial__marks" aria-hidden="true">
            {MARKS.map((m) => (
              <button
                key={m.at + m.label}
                className={`dial__mark${Math.abs(rho - m.at) < 0.4 ? ' dial__mark--active' : ''}`}
                style={{ left: `${toPos(m.at) * 100}%`, top: m.row ? 18 : 0 }}
                onClick={() => {
                  director.cancel('rho')
                  setParam(RHO, m.at)
                }}
                tabIndex={-1}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <span className="slider__val">{rho.toFixed(2)}</span>
      </div>
      <p className="dial__state" aria-live="polite">
        {describe(rho)}
      </p>
    </div>
  )
}
