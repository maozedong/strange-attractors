import { useEffect, useState } from 'react'
import { useStore } from './store'
import { CHAPTERS } from './content/chapters'
import { registerWing5 } from './content/wing5'

registerWing5()
import { Scene } from './scene/Scene'
import { swarmStatus } from './scene/Swarm'
import { TopBar } from './ui/TopBar'
import { Hud } from './ui/Hud'
import { TitleScreen } from './ui/TitleScreen'
import { NarrativePanel, Aside } from './ui/NarrativePanel'
import { FreePlayToolbar } from './ui/FreePlayToolbar'
import { WingMap } from './ui/WingMap'
import { Unsupported } from './ui/Unsupported'
import { SoundNotice } from './ui/SoundNotice'
import { useTelemetry } from './ui/useTelemetry'
import { AudioCues } from './audio/AudioCues'
import { audio } from './audio/engine'
import { director } from './director/director'
import { FILM } from './film/flag'
import { FilmCaptions } from './film/FilmCaptions'

const PROGRESS_KEY = 'strange-attractors:chapter'

function readProgress(): number {
  try {
    const n = Number(localStorage.getItem(PROGRESS_KEY))
    return Number.isInteger(n) && n > 0 && n < CHAPTERS.length ? n : 0
  } catch {
    return 0
  }
}

export default function App() {
  const chapter = useStore((s) => s.chapter)
  const freePlay = useStore((s) => s.freePlay)
  const [mapOpen, setMapOpen] = useState(false)
  const [savedChapter] = useState(readProgress)
  useTelemetry(1) // re-check swarmStatus once a second

  // Apply the chapter's scene preset and start its autoplay whenever the chapter changes
  useEffect(() => {
    const c = CHAPTERS[chapter]
    if (!c) return
    director.stop()
    c.onEnter(useStore.getState())
    if (chapter > 0) {
      void director.play(c.id, c.cues)
      try {
        localStorage.setItem(PROGRESS_KEY, String(chapter))
      } catch {
        /* private mode */
      }
    } else {
      audio.stopNarration()
    }
  }, [chapter])

  useEffect(() => {
    if (freePlay) director.stop()
  }, [freePlay])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const s = useStore.getState()
      if (mapOpen) return
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        if (s.freePlay) return
        e.preventDefault()
        if (s.chapter === 0) {
          audio.unlock()
          audio.setAmbient(true)
        }
        s.setChapter(Math.min(CHAPTERS.length - 1, s.chapter + 1))
      } else if (e.key === 'ArrowLeft') {
        if (s.freePlay) return
        e.preventDefault()
        s.setChapter(Math.max(0, s.chapter - 1))
      } else if (e.key === 'Escape') {
        if (s.freePlay) s.setFreePlay(false)
      } else if (e.key === 'm') {
        setMapOpen(true)
      } else if ((e.key === 'p' || e.key === 'k') && s.stage === 'swarm') {
        s.setPaused(!s.paused)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapOpen])

  const openMap = () => {
    audio.unlock()
    setMapOpen(true)
  }

  if (FILM) {
    return (
      <div className="app">
        <Scene />
        <div className="overlay">
          <FilmCaptions />
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Scene />
      <AudioCues />
      <div className="overlay">
        {swarmStatus.error ? (
          <Unsupported error={swarmStatus.error} />
        ) : (
          <>
            <TopBar onMap={openMap} />
            <SoundNotice />
            {(chapter > 0 || freePlay) && <Hud />}
            {freePlay ? (
              <FreePlayToolbar />
            ) : chapter === 0 ? (
              <TitleScreen savedChapter={savedChapter} onMap={openMap} />
            ) : (
              <>
                <NarrativePanel />
                <Aside />
              </>
            )}
            {mapOpen && <WingMap onClose={() => setMapOpen(false)} />}
          </>
        )}
      </div>
    </div>
  )
}
