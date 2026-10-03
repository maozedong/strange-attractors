import { useStore } from '../../store'
import { useTelemetry } from '../useTelemetry'
import { worldTele } from '../../world/telemetry'
import { requestMic, voiceStatus } from '../../world/voice'
import { audio } from '../../audio/engine'
import { fixed } from '../format'

export function VoiceInstrument() {
  const v = useStore((s) => s.voice)
  const setVoice = useStore((s) => s.setVoice)
  useTelemetry(8)
  return (
    <>
      <div className="row">
        <span className="label">Listening to</span>
        <div className="choice" role="group" aria-label="Sound source">
          <button aria-pressed={v.source === 'narration'} onClick={() => setVoice({ source: 'narration' })}>
            the narrator
          </button>
          <button
            aria-pressed={v.source === 'mic'}
            onClick={() => {
              audio.unlock()
              // choose the mic first so the stage waits for it; fall back only if still waiting
              setVoice({ source: 'mic' })
              void requestMic().then((ok: boolean) => {
                if (!ok && useStore.getState().voice.source === 'mic') setVoice({ source: 'tone' })
              })
            }}
          >
            my microphone
          </button>
          <button
            aria-pressed={v.source === 'tone'}
            onClick={() => {
              audio.unlock()
              setVoice({ source: 'tone' })
            }}
          >
            a steady vowel
          </button>
        </div>
      </div>
      <div className="slider">
        <span className="slider__sym">delay</span>
        <input
          type="range"
          min={0.4}
          max={6}
          step={0.1}
          value={v.delayMs}
          aria-label="Embedding delay, milliseconds"
          onChange={(e) => setVoice({ delayMs: Number(e.target.value) })}
        />
        <span className="slider__val">{v.delayMs.toFixed(1)} ms</span>
      </div>
      <div className="row">
        <span className="label">Level</span>
        <span className="readout">{Math.round(worldTele.voiceLevel * 100)}%</span>
        <span className="label">Pitch</span>
        <span className="readout">{worldTele.voicePitch > 0 ? `${fixed(worldTele.voicePitch, 0)} Hz` : '—'}</span>
      </div>
      {voiceStatus.micError && <p className="label">{voiceStatus.micError}</p>}
      <p className="label">Nothing you say is recorded or sent anywhere.</p>
    </>
  )
}
