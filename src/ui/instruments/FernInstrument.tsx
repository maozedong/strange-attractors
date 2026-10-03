import { useStore } from '../../store'
import { director } from '../../director/director'
import { PRESET_LABELS } from '../../fractal/ifs'
import type { IfsPreset } from '../../fractal/types'

const PRESETS: IfsPreset[] = ['sierpinski', 'fern', 'dragon', 'leaf', 'spiral']

export function FernInstrument() {
  const ifs = useStore((s) => s.ifs)
  const setIfs = useStore((s) => s.setIfs)
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="Rules">
          {PRESETS.map((p) => (
            <button
              key={p}
              aria-pressed={ifs.preset === p}
              onClick={() => {
                director.cancel('variation')
                setIfs({ preset: p, rate: Math.max(ifs.rate, 24), variation: 0 })
              }}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="slider">
        <span className="slider__sym">species</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={ifs.variation}
          aria-label="Nudge the rules"
          onChange={(e) => {
            director.cancel('variation')
            setIfs({ variation: Number(e.target.value) })
          }}
        />
        <span className="slider__val">{ifs.variation.toFixed(2)}</span>
      </div>
      <div className="row">
        <span className="label">Rolls per second</span>
        <div className="choice" role="group" aria-label="Rolls per second">
          {[1, 4, 24].map((r) => (
            <button key={r} aria-pressed={ifs.rate === r} onClick={() => setIfs({ rate: r })}>
              {r}
            </button>
          ))}
        </div>
        <button className="textbtn" onClick={() => setIfs({ resetSerial: ifs.resetSerial + 1 })}>
          Scatter the points again
        </button>
      </div>
    </>
  )
}
