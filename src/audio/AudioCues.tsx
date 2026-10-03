import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { CHAPTERS } from '../content/chapters'
import { NARRATION } from './script'
import { tele } from '../sim/telemetry'
import { audio } from './engine'

/**
 * Wires the audio engine to app state: a page-turn tick on chapter change, the
 * "twins split" ping when the separation first becomes visible, prefetching the next
 * narration, and the sound / narration preferences. Narration itself is started by the
 * director (see App), so pictures and voice share one clock.
 */
export function AudioCues() {
  const chapter = useStore((s) => s.chapter)
  const freePlay = useStore((s) => s.freePlay)
  const sound = useStore((s) => s.sound)
  const narration = useStore((s) => s.narration)
  const prevChapter = useRef(chapter)

  useEffect(() => {
    audio.armAutoUnlock()
  }, [])

  useEffect(() => {
    audio.setMuted(!sound)
  }, [sound])

  // the ambient bed plays whenever the visitor is inside the tour (starts once audio is unlocked)
  useEffect(() => {
    audio.setAmbient(chapter > 0 && sound)
  }, [chapter, sound])

  useEffect(() => {
    audio.setNarrationEnabled(narration)
  }, [narration])

  useEffect(() => {
    const c = CHAPTERS[chapter]
    const moved = prevChapter.current !== chapter
    prevChapter.current = chapter
    if (!c || chapter === 0) return
    if (moved) void audio.sfx('turn', 4) // the generated tap is very quiet; boost it
    const next = CHAPTERS[chapter + 1]
    if (next && NARRATION[next.id]) audio.prefetch(`vo-${next.id}`)
  }, [chapter])

  useEffect(() => {
    if (freePlay) audio.stopNarration()
  }, [freePlay])

  // the twins' separation becoming visible: one soft ping per run
  useEffect(() => {
    let pinged = false
    let lastCount = 0
    const id = window.setInterval(() => {
      if (tele.sepCount < lastCount) pinged = false
      lastCount = tele.sepCount
      if (!pinged && tele.sepCount > 0 && tele.twinSep > 0.5) {
        pinged = true
        if (CHAPTERS[useStore.getState().chapter]?.id === 'twins') void audio.sfx('split', 0.8)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [])

  return null
}
