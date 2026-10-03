import { useStore } from '../store'
import { CHAPTERS, WINGS, chaptersOfWing, chapterIndex } from '../content/chapters'
import { SoundSwitch } from './SoundSwitch'

const SPEEDS = [0.5, 1, 2, 4]

export function TopBar({ onMap }: { onMap: () => void }) {
  const chapter = useStore((s) => s.chapter)
  const setChapter = useStore((s) => s.setChapter)
  const speed = useStore((s) => s.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const paused = useStore((s) => s.paused)
  const setPaused = useStore((s) => s.setPaused)
  const freePlay = useStore((s) => s.freePlay)
  const setFreePlay = useStore((s) => s.setFreePlay)
  const stage = useStore((s) => s.stage)

  const cycleSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__name">Strange Attractors</span>
        {!freePlay && (
          <ol className="ticks" aria-label="Chapters">
            <li>
              <button aria-current={chapter === 0 ? 'true' : undefined} aria-label="Title" title="Title" onClick={() => setChapter(0)} />
            </li>
            {WINGS.map((w) => (
              <li key={w.id} className="ticks__wing" aria-label={`Wing ${w.numeral}: ${w.title}`}>
                {chaptersOfWing(w.id).map((c) => {
                  const idx = chapterIndex(c.id)
                  return (
                    <button
                      key={c.id}
                      aria-current={idx === chapter ? 'true' : undefined}
                      aria-label={`${w.title}: ${c.title}`}
                      title={c.title}
                      onClick={() => setChapter(idx)}
                    />
                  )
                })}
              </li>
            ))}
          </ol>
        )}
        {!freePlay && (
          <button className="textbtn" onClick={onMap}>
            Map
          </button>
        )}
      </div>
      <nav className="topbar__controls" aria-label="Playback">
        {stage === 'swarm' && (
          <>
            <button className="textbtn textbtn--wide" onClick={cycleSpeed} aria-label={`Speed ${speed} times, click to change`}>
              Speed ×{speed}
            </button>
            <button className="textbtn textbtn--wide" onClick={() => setPaused(!paused)} aria-pressed={paused}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </>
        )}
        <SoundSwitch />
        {(stage === 'swarm' || freePlay) && (
          <button className="textbtn" onClick={() => setFreePlay(!freePlay)} aria-pressed={freePlay}>
            {freePlay ? 'Back to the tour' : 'Free play'}
          </button>
        )}
      </nav>
      <span className="sr-only">{CHAPTERS[chapter]?.title}</span>
    </header>
  )
}
