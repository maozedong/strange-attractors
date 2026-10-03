import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { useStore } from './store'
import { queueSteps, tele } from './sim/telemetry'
import { cameraDirector } from './scene/cameraDirector'
import { director } from './director/director'
import { audio } from './audio/engine'

// a small, always-on handle for support: `strangeAttractors.audio.state` in the console
;(window as unknown as { strangeAttractors: unknown }).strangeAttractors = { audio, store: useStore }

if (import.meta.env.DEV) {
  // console helpers: __chaos.store.getState().setChapter(3); __chaos.advance(20)
  ;(window as unknown as { __chaos: unknown }).__chaos = {
    store: useStore,
    tele,
    camera: cameraDirector,
    director,
    audio,
    advance: (units: number, frames = 1) => queueSteps(Math.round(units / tele.dt), frames),
  }
}

// No StrictMode on purpose: the GPU simulation allocates render targets in effects and
// double-invocation would create and discard a second copy on every mount.
createRoot(document.getElementById('root')!).render(<App />)
