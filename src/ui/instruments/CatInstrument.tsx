import { useStore } from '../../store'
import { director } from '../../director/director'
import { CAT_PERIOD, captureCamera, catStatus } from '../../fractal/cat'
import { useTelemetry } from '../useTelemetry'
import { getCatStep } from '../../fractal/cat'

export function CatInstrument() {
  const cat = useStore((s) => s.cat)
  const setCat = useStore((s) => s.setCat)
  useTelemetry(8)
  const step = getCatStep()
  const back = step > 0 && step % CAT_PERIOD === 0
  return (
    <>
      <div className="row">
        <span className="label">Step</span>
        <span className="readout">
          {step} of {CAT_PERIOD}
        </span>
        <span className="label">{back ? 'Every pixel is home.' : step === 0 ? 'Untouched.' : 'Scrambled.'}</span>
      </div>
      <div className="row">
        <span className="label">Steps per second</span>
        <div className="choice" role="group" aria-label="Steps per second">
          {[0, 1, 4, 20].map((r) => (
            <button
              key={r}
              aria-pressed={cat.rate === r}
              onClick={() => {
                director.cancel('catrate')
                setCat({ rate: r, stopAt: null })
              }}
            >
              {r === 0 ? 'stop' : r}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="textbtn" onClick={() => setCat({ resetSerial: cat.resetSerial + 1, rate: 0, stopAt: null })}>
          Start again
        </button>
        <button
          className="textbtn"
          onClick={() => {
            void captureCamera().then(() => setCat({ source: 'camera', resetSerial: cat.resetSerial + 1, rate: 0, stopAt: null }))
          }}
        >
          Use my face instead
        </button>
        {cat.source === 'camera' && (
          <button className="textbtn" onClick={() => setCat({ source: 'cat', resetSerial: cat.resetSerial + 1, rate: 0, stopAt: null })}>
            Back to the cat
          </button>
        )}
      </div>
      {catStatus.cameraError && <p className="label">{catStatus.cameraError}</p>}
      <p className="label">Photo: Alicja Koczaska, CC0. Your camera picture never leaves this page.</p>
    </>
  )
}
