import { useStore } from '../../store'
import { director } from '../../director/director'
import { TURING_PRESETS } from '../../world/turing'

export function TuringInstrument() {
  const t = useStore((s) => s.turing)
  const setTuring = useStore((s) => s.setTuring)
  const current = TURING_PRESETS.find((p) => Math.abs(p.feed - t.feed) < 1e-4 && Math.abs(p.kill - t.kill) < 1e-4)
  const set = (patch: Partial<typeof t>) => {
    director.cancel('feed')
    director.cancel('kill')
    setTuring(patch)
  }
  return (
    <>
      <div className="row">
        <div className="choice" role="group" aria-label="Coat">
          {TURING_PRESETS.map((p) => (
            <button key={p.id} aria-pressed={current?.id === p.id} onClick={() => set({ feed: p.feed, kill: p.kill })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="slider">
        <span className="slider__sym">feed</span>
        <input type="range" min={0.01} max={0.08} step={0.0005} value={t.feed} aria-label="Feed rate" onChange={(e) => set({ feed: Number(e.target.value) })} />
        <span className="slider__val">{t.feed.toFixed(4)}</span>
      </div>
      <div className="slider">
        <span className="slider__sym">kill</span>
        <input type="range" min={0.045} max={0.07} step={0.0005} value={t.kill} aria-label="Kill rate" onChange={(e) => set({ kill: Number(e.target.value) })} />
        <span className="slider__val">{t.kill.toFixed(4)}</span>
      </div>
      <div className="row">
        <button className="textbtn" onClick={() => setTuring({ resetSerial: t.resetSerial + 1 })}>
          Start from bare skin again
        </button>
        <button className="textbtn" onClick={() => setTuring({ running: !t.running })}>
          {t.running ? 'Freeze' : 'Resume'}
        </button>
      </div>
    </>
  )
}
