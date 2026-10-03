import { useStore } from '../../store'
import { director } from '../../director/director'
import { cameraDirector } from '../../scene/cameraDirector'

export function BulbInstrument() {
  const bulb = useStore((s) => s.bulb)
  const setBulb = useStore((s) => s.setBulb)
  return (
    <>
      <div className="slider">
        <span className="slider__sym">power</span>
        <input
          type="range"
          min={2}
          max={12}
          step={0.05}
          value={bulb.power}
          aria-label="Power"
          onChange={(e) => {
            director.cancel('power')
            setBulb({ power: Number(e.target.value) })
          }}
        />
        <span className="slider__val">{bulb.power.toFixed(2)}</span>
      </div>
      <p className="dial__state">
        {bulb.interactive ? (
          'Drag to turn it, scroll to dive in.'
        ) : (
          <button
            className="textbtn"
            onClick={() => {
              setBulb({ interactive: true })
              cameraDirector.release()
            }}
          >
            Take the camera
          </button>
        )}
      </p>
    </>
  )
}
