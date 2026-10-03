import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { director } from '../../director/director'
import { RULERS, walkInfo, loadBritain, boxCounts, boxDimension } from '../../fractal/coast'
import { CHAPTERS } from '../../content/chapters'
import { int } from '../format'

export const BOX_EDGES = [0.25, 0.125, 0.0625, 0.03125]

export function CoastInstrument() {
  const coast = useStore((s) => s.coast)
  const setCoast = useStore((s) => s.setCoast)
  const stage = useStore((s) => s.stage)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let on = true
    void loadBritain().then(() => on && setReady(true))
    return () => {
      on = false
    }
  }, [])
  const info = ready && coast.ruler > 0 ? walkInfo(coast.ruler) : null
  const counts = stage === 'swarm' ? boxCounts(BOX_EDGES) : []
  const current = counts.find((c) => c.edge === coast.box)
  return (
    <>
      {stage === 'coast' ? (
        <>
          <div className="row">
            <span className="label">Ruler</span>
            <div className="choice" role="group" aria-label="Ruler length">
              {RULERS.filter((r) => r <= 200).map((r) => (
                <button
                  key={r}
                  aria-pressed={coast.ruler === r}
                  onClick={() => {
                    director.cancel('walk')
                    setCoast({ ruler: r, walk: 0 })
                    director.tween('walk', 0, 1, 2.5, (v) => useStore.getState().setCoast({ walk: v }))
                  }}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="label">Steps</span>
            <span className="readout">{info ? int(info.count * coast.walk) : '—'}</span>
            <span className="label">Coast so far</span>
            <span className="readout">{info ? `${int(info.count * coast.walk * coast.ruler)} km` : '—'}</span>
          </div>
          <div className="row">
            <button className="textbtn" onClick={() => boxTheButterfly()}>
              Now box the butterfly
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <span className="label">Box edge</span>
            <div className="choice" role="group" aria-label="Box edge">
              {BOX_EDGES.map((e) => (
                <button key={e} aria-pressed={coast.box === e} onClick={() => setCoast({ box: e })}>
                  1/{Math.round(1 / e)}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="label">Boxes touched</span>
            <span className="readout">{current ? int(current.count) : '—'}</span>
            <span className="label">Slope from this sample</span>
            <span className="readout">{counts.length ? boxDimension(BOX_EDGES).toFixed(2) : '—'}</span>
          </div>
          <p className="dial__state">
            A finite trajectory undercounts the small boxes. With infinitely many points the slope reaches 2.06.
          </p>
        </>
      )}
    </>
  )
}

/** switch the chapter's stage from the coast to the swarm with boxes, from the panel or a cue */
export function boxTheButterfly() {
  const s = useStore.getState()
  const c = CHAPTERS[s.chapter]
  if (c?.id !== 'coast') return
  s.setStage('swarm')
  s.setSwarmVisible(true)
  s.setSwarmOpacity(0.85)
  s.setColorMode('speed')
  s.pushSwarm({ type: 'spawnAttractor' })
  s.setCoast({ box: 0.25 })
}
