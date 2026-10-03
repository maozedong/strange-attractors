import { useEffect, useState } from 'react'

interface Caption {
  title?: string
  sub?: string
  /** 0..1, set per frame by the recording script (CSS transitions would run on the wall clock) */
  opacity: number
  /** 'wall' = bottom-left wall text; 'centre' = the title treatment */
  style?: 'wall' | 'centre'
}

/** The captions layer for recordings; `window.__filmCaption(c)` sets it. */
export function FilmCaptions() {
  const [c, setC] = useState<Caption>({ opacity: 0 })
  useEffect(() => {
    ;(window as unknown as { __filmCaption: (c: Caption) => void }).__filmCaption = setC
  }, [])
  return (
    <div className={`film film--${c.style ?? 'wall'}`} style={{ opacity: c.opacity }} aria-hidden="true">
      {c.title && <h1>{c.title}</h1>}
      {c.sub && <p>{c.sub}</p>}
    </div>
  )
}
