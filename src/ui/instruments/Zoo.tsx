import { useStore } from '../../store'
import { audio } from '../../audio/engine'
import { SYSTEMS, getSystem } from '../../systems'

export function Zoo() {
  const systemId = useStore((s) => s.systemId)
  const setSystem = useStore((s) => s.setSystem)
  const current = getSystem(systemId)
  return (
    <>
      <ul className="zoo" aria-label="Attractors">
        {SYSTEMS.map((s) => (
          <li key={s.id}>
            <button
              aria-pressed={s.id === systemId}
              onClick={() => {
                if (s.id !== systemId) void audio.sfx('shimmer', 0.7)
                setSystem(s.id)
              }}
            >
              <span>{s.name}</span>
              <small>{s.year}</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="zoo__blurb">
        <strong>{current.name}.</strong> {current.blurb}
      </p>
    </>
  )
}
