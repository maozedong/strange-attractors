import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { audio } from '../audio/engine'

/**
 * One explicit switch for everything the visitor hears, with a small level meter fed from
 * the master output. The meter answers the question a silent page cannot: is the app
 * making sound right now? If the bars move and nothing is heard, the device is muted.
 */
export function SoundSwitch() {
  const sound = useStore((s) => s.sound)
  const setSound = useStore((s) => s.setSound)
  const bars = useRef<HTMLSpanElement[]>([])

  useEffect(() => {
    let raf = 0
    let analyser: AnalyserNode | null = null
    let buf: Float32Array<ArrayBuffer> | null = null
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const ctx = audio.context
      if (!ctx || !audio.masterNode) return
      if (!analyser) {
        analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        audio.masterNode.connect(analyser)
        buf = new Float32Array(analyser.fftSize)
      }
      if (!buf) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      // three bars lighting up at rising levels; speech sits around 0.05–0.2
      const level = Math.min(1, rms / 0.18)
      bars.current.forEach((b, i) => {
        if (b) b.style.opacity = String(level > (i + 0.5) / 3 ? 1 : 0.22)
      })
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (analyser && audio.masterNode) {
        try {
          audio.masterNode.disconnect(analyser)
        } catch {
          /* already gone */
        }
      }
    }
  }, [])

  return (
    <label className="sound">
      <span className="sound__label">Sound</span>
      <input
        type="checkbox"
        role="switch"
        checked={sound}
        aria-label="Sound: narration, ambience and effects"
        onChange={(e) => {
          audio.unlock()
          setSound(e.target.checked)
        }}
      />
      <span className="sound__meter" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            ref={(el) => {
              if (el) bars.current[i] = el
            }}
          />
        ))}
      </span>
    </label>
  )
}
