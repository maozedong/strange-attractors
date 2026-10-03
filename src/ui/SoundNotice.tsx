import { useStore } from '../store'
import { audio } from '../audio/engine'
import { useTelemetry } from './useTelemetry'

/** Shown only when the visitor wants sound but the browser has not let it start yet. */
export function SoundNotice() {
  useTelemetry(2)
  const sound = useStore((s) => s.sound)
  const chapter = useStore((s) => s.chapter)
  if (!sound || chapter === 0 || audio.state === 'running') return null
  return (
    <button className="notice" onClick={() => audio.unlock()}>
      Tap to turn sound on
    </button>
  )
}
