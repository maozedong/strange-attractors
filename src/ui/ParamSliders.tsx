import { useStore } from '../store'
import { getSystem } from '../systems'

export function ParamSliders() {
  const systemId = useStore((s) => s.systemId)
  const params = useStore((s) => s.params)
  const setParam = useStore((s) => s.setParam)
  const sys = getSystem(systemId)
  return (
    <div className="toolbar__sliders">
      {sys.params.map((p, i) => (
        <div className="slider" key={p.key}>
          <span className="slider__sym">{p.label}</span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step ?? (p.max - p.min) / 400}
            value={params[i] ?? p.default}
            aria-label={p.label}
            onChange={(e) => setParam(i, Number(e.target.value))}
          />
          <span className="slider__val">{(params[i] ?? p.default).toFixed(decimals(p.step))}</span>
        </div>
      ))}
    </div>
  )
}

function decimals(step?: number) {
  if (!step) return 3
  const s = step.toString()
  const i = s.indexOf('.')
  return i < 0 ? 0 : Math.min(4, s.length - i - 1)
}
