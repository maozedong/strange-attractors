import { useStore } from '../../store'
import { MANDEL_TARGETS } from '../../fractal/mandel/targets'
import { animateMandelTo } from '../../fractal/mandel/MandelbrotPlane'
import { sci } from '../format'

const PLACES: { key: keyof typeof MANDEL_TARGETS; label: string }[] = [
  { key: 'overview', label: 'The whole set' },
  { key: 'period3', label: 'The copy on the axis' },
  { key: 'seahorse', label: 'Seahorse valley' },
  { key: 'elephant', label: 'Elephant valley' },
]

export function ZoomInstrument() {
  const scale = useStore((s) => s.fractal.mandel.scale)
  const interactive = useStore((s) => s.fractal.mandelInteractive)
  const setFractal = useStore((s) => s.setFractal)
  const magnification = 1.1 / scale
  return (
    <>
      <div className="row">
        <span className="label">Magnification</span>
        <span className="readout">{sci(magnification, 1)}×</span>
      </div>
      <div className="row">
        <div className="choice" role="group" aria-label="Places">
          {PLACES.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setFractal({ mandelInteractive: true })
                animateMandelTo(MANDEL_TARGETS[p.key], 6)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="dial__state">
        {interactive ? 'Scroll over the picture to dive in, drag to move.' : 'The camera will hand over to you in a moment.'}
      </p>
    </>
  )
}
