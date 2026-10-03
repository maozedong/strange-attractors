import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { sandpileStatus, IDENTITY_GRAINS } from '../../world/sandpile'
import { int } from '../format'

export function SandpileInstrument() {
  const s = useStore((x) => x.sandpile)
  const setSandpile = useStore((x) => x.setSandpile)
  useTelemetry(6)
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="What to show">
          <button aria-pressed={!s.identity} onClick={() => setSandpile({ identity: false })}>
            the live pile
          </button>
          <button aria-pressed={s.identity} onClick={() => setSandpile({ identity: true })} disabled={!sandpileStatus.identityReady}>
            {sandpileStatus.identityReady ? `${int(IDENTITY_GRAINS)} grains on one spot` : 'computing the pattern…'}
          </button>
        </div>
      </div>
      {!s.identity && (
        <>
          <div className="row">
            <span className="label">Grains per second</span>
            <div className="choice" role="group" aria-label="Grains per second">
              {[20, 200, 1000].map((r) => (
                <button key={r} aria-pressed={s.rate === r} onClick={() => setSandpile({ rate: r, running: true })}>
                  {int(r)}
                </button>
              ))}
            </div>
            <div className="choice" role="group" aria-label="Where they fall">
              <button aria-pressed={s.mode === 'random'} onClick={() => setSandpile({ mode: 'random' })}>
                anywhere
              </button>
              <button aria-pressed={s.mode === 'centre'} onClick={() => setSandpile({ mode: 'centre' })}>
                on the middle
              </button>
            </div>
          </div>
          <div className="row">
            <span className="label">Grains</span>
            <span className="readout">{int(worldTele.sandGrains)}</span>
            <span className="label">Last avalanche</span>
            <span className="readout">{int(worldTele.sandLastAvalanche)} topplings</span>
            <button className="textbtn" onClick={() => setSandpile({ resetSerial: s.resetSerial + 1 })}>
              Fresh pile
            </button>
          </div>
        </>
      )}
    </>
  )
}
