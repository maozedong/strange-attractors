import { useStore } from '../store'
import { CHAPTERS, WINGS, chaptersOfWing, wingOf } from '../content/chapters'
import { director } from '../director/director'
import { NARRATION } from '../audio/script'
import { audio } from '../audio/engine'

export function NarrativePanel() {
  const chapter = useStore((s) => s.chapter)
  const setChapter = useStore((s) => s.setChapter)
  const c = CHAPTERS[chapter]
  if (!c || chapter === 0) return null
  const wing = wingOf(c.wing)
  const siblings = chaptersOfWing(c.wing)
  const n = siblings.findIndex((x) => x.id === c.id) + 1
  const lastOfWing = n === siblings.length
  const nextWing = WINGS[WINGS.findIndex((w) => w.id === c.wing) + 1]
  const last = chapter === CHAPTERS.length - 1
  const Instrument = c.instrument
  return (
    <section className="panel" aria-labelledby="chapter-title">
      <div className="panel__body" key={c.id}>
        <p className="panel__chapter">
          {wing.title}, {n} of {siblings.length}
        </p>
        <h2 id="chapter-title">{c.title}</h2>
        {c.body}
        {Instrument && (
          <div className="panel__instrument">
            <Instrument />
          </div>
        )}
      </div>
      <nav className="panel__nav" aria-label="Chapter navigation">
        <button className="textbtn" onClick={() => setChapter(chapter - 1)}>
          Back
        </button>
        {(NARRATION[c.id] || c.cues) && (
          <button
            className="textbtn"
            onClick={() => {
              audio.unlock()
              director.replay(c.onEnter, c.cues)
            }}
          >
            Replay
          </button>
        )}
        {lastOfWing && nextWing ? (
          <button className="textbtn textbtn--primary" onClick={() => setChapter(chapter + 1)}>
            <span className="nav__full">
              Wing {nextWing.numeral}: {nextWing.title}
            </span>
            <span className="nav__short">Next wing</span>
          </button>
        ) : !last ? (
          <button className="textbtn textbtn--primary" onClick={() => setChapter(chapter + 1)}>
            Continue
          </button>
        ) : null}
      </nav>
    </section>
  )
}

export function Aside() {
  const chapter = useStore((s) => s.chapter)
  const c = CHAPTERS[chapter]
  if (!c?.aside) return null
  const A = c.aside
  return (
    <div className="aside" key={c.id}>
      <A />
    </div>
  )
}
