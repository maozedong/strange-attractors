import { useStore } from '../store'
import { audio } from '../audio/engine'
import { CHAPTERS } from '../content/chapters'

export function TitleScreen({ savedChapter, onMap }: { savedChapter: number; onMap: () => void }) {
  const setChapter = useStore((s) => s.setChapter)
  const begin = (at: number) => {
    audio.unlock()
    audio.setAmbient(true)
    setChapter(at)
  }
  const saved = CHAPTERS[savedChapter]
  return (
    <section className="title" aria-label="Title">
      <h1>Strange Attractors</h1>
      <p>A short tour of chaos, in three dimensions</p>
      <button className="title__begin" onClick={() => begin(1)} autoFocus>
        Begin
      </button>
      <span className="title__hint">
        {saved && savedChapter > 0 ? (
          <>
            <button className="textbtn" onClick={() => begin(savedChapter)}>
              Pick up at "{saved.title}"
            </button>
            {' or '}
          </>
        ) : null}
        <button className="textbtn" onClick={onMap}>
          choose a chapter
        </button>
        . Drag to orbit. Space to continue. Narrated: turn your sound on.
      </span>
    </section>
  )
}
