import { useStore } from '../../store'
import { director } from '../../director/director'
import { PERIOD3_WINDOW } from '../../fractal/logistic'

function rhythm(r: number): string {
  if (r < 1) return 'The tap stops.'
  if (r < 3) return 'One rhythm: every gap the same.'
  if (r < 3.4495) return 'Two gaps, long and short, repeating.'
  if (r < 3.5441) return 'Four gaps repeating.'
  if (r < 3.5644) return 'Eight gaps repeating.'
  if (r < 3.5699) return 'Sixteen, thirty-two, sixty-four… the splits arrive faster and faster.'
  if (r >= PERIOD3_WINDOW[0] && r <= PERIOD3_WINDOW[1]) return 'A window: three gaps repeating, inside the chaos.'
  return 'No rhythm. Every gap different, forever.'
}

export function TapInstrument() {
  const r = useStore((s) => s.fractal.r)
  const setFractal = useStore((s) => s.setFractal)
  return (
    <div className="dial">
      <div className="slider">
        <span className="slider__sym">r</span>
        <input
          type="range"
          min={2.5}
          max={4}
          step={0.001}
          value={r}
          aria-label="Tap setting, r"
          onChange={(e) => {
            director.cancel('r')
            setFractal({ r: Number(e.target.value) })
          }}
        />
        <span className="slider__val">{r.toFixed(3)}</span>
      </div>
      <p className="dial__state" aria-live="polite">
        {rhythm(r)}
      </p>
    </div>
  )
}
