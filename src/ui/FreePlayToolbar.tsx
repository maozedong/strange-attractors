import { useStore } from '../store'
import { audio } from '../audio/engine'
import { SYSTEMS, getSystem } from '../systems'
import { ParamSliders } from './ParamSliders'
import { CLOUD_RADIUS } from '../content/chapters'

export function FreePlayToolbar() {
  const systemId = useStore((s) => s.systemId)
  const setSystem = useStore((s) => s.setSystem)
  const resetParams = useStore((s) => s.resetParams)
  const pushSwarm = useStore((s) => s.pushSwarm)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const showFixed = useStore((s) => s.showFixedPoints)
  const setShowFixed = useStore((s) => s.setShowFixedPoints)
  const sys = getSystem(systemId)

  const dropCloud = () => {
    const { params } = useStore.getState()
    useStore.getState().setColorMode('origin')
    pushSwarm({ type: 'spawnCloud', center: sys.seed(params), radius: CLOUD_RADIUS / sys.frame(params).scale / 25 })
  }

  return (
    <section className="toolbar" aria-label="Free play">
      <h3>{sys.name}</h3>
      <p className="toolbar__credit">
        {sys.credit}, {sys.year}. {sys.tagline}
      </p>
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
      <ParamSliders />
      <div className="row">
        <button className="textbtn" onClick={resetParams}>
          Reset dials
        </button>
        <button className="textbtn" onClick={() => pushSwarm({ type: 'spawnAttractor' })}>
          Scatter on the attractor
        </button>
        <button className="textbtn" onClick={dropCloud}>
          Drop a cloud
        </button>
      </div>
      <div className="row">
        <div className="choice" role="group" aria-label="Colour mode">
          <button aria-pressed={colorMode === 'speed'} onClick={() => setColorMode('speed')}>
            by speed
          </button>
          <button aria-pressed={colorMode === 'origin'} onClick={() => setColorMode('origin')}>
            by origin
          </button>
        </div>
        {sys.fixedPoints && (
          <label className="toggle">
            <input type="checkbox" checked={showFixed} onChange={(e) => setShowFixed(e.target.checked)} />
            Still points
          </label>
        )}
      </div>
    </section>
  )
}
