import { useStore } from '../../store'
import { getSystem } from '../../systems'
import { CLOUD_RADIUS, releaseSwarm } from '../../content/chapters'
import { useTelemetry } from '../useTelemetry'
import { fixed } from '../format'
import { audio } from '../../audio/engine'

export function SwarmInstrument() {
  const paused = useStore((s) => s.paused)
  const setPaused = useStore((s) => s.setPaused)
  const pushSwarm = useStore((s) => s.pushSwarm)
  const t = useTelemetry(8)
  const armed = paused && t.simTime === 0

  const replay = () => {
    const sys = getSystem('lorenz')
    const seed = sys.seed(sys.params.map((p) => p.default))
    useStore.getState().setColorMode('origin')
    pushSwarm({ type: 'spawnCloud', center: seed, radius: CLOUD_RADIUS })
    setPaused(true)
  }

  return (
    <div className="row">
      {armed ? (
        <button
          className="action"
          onClick={() => {
            audio.unlock()
            releaseSwarm(useStore.getState())
          }}
        >
          Release the swarm
        </button>
      ) : (
        <button className="action" onClick={replay}>
          Pack them back in
        </button>
      )}
      <span className="label">Time since release</span>
      <span className="readout">{fixed(t.simTime, 1)}</span>
    </div>
  )
}
