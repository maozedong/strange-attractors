import { useEffect } from 'react'
import { useStore } from '../store'
import { CHAPTERS, WINGS, chapterIndex, chaptersOfWing } from '../content/chapters'

/** Full-screen overview of the wings and their chapters; jump anywhere. */
export function WingMap({ onClose }: { onClose: () => void }) {
  const chapter = useStore((s) => s.chapter)
  const setChapter = useStore((s) => s.setChapter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <section className="map" aria-label="Map of the tour">
      <div className="map__inner">
        <header className="map__head">
          <h2>The tour</h2>
          <button className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="map__wings">
          {WINGS.map((w) => (
            <div className="map__wing" key={w.id}>
              <h3>
                <span className="map__numeral">{w.numeral}</span> {w.title}
              </h3>
              <p className="map__tagline">{w.tagline}</p>
              <ol className="map__chapters">
                {chaptersOfWing(w.id).map((c, i) => {
                  const idx = chapterIndex(c.id)
                  return (
                    <li key={c.id}>
                      <button
                        aria-current={idx === chapter ? 'true' : undefined}
                        onClick={() => {
                          setChapter(idx)
                          onClose()
                        }}
                      >
                        <span className="map__n">{i + 1}</span> {c.title}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
        <p className="map__foot">
          {CHAPTERS.length - 1} chapters. Each one plays itself with the narration; the dials are yours whenever you
          want them.
        </p>
      </div>
    </section>
  )
}
