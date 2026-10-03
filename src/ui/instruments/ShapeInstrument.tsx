import { useStore } from '../../store'

export function ShapeInstrument() {
  const show = useStore((s) => s.showFixedPoints)
  const setShow = useStore((s) => s.setShowFixedPoints)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  return (
    <>
      <div className="row">
        <label className="toggle">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Mark the still points
        </label>
      </div>
      <div className="row">
        <span className="label">Paint each particle by</span>
        <div className="choice" role="group" aria-label="Colour mode">
          <button aria-pressed={colorMode === 'speed'} onClick={() => setColorMode('speed')}>
            its speed
          </button>
          <button aria-pressed={colorMode === 'origin'} onClick={() => setColorMode('origin')}>
            where it started
          </button>
        </div>
      </div>
    </>
  )
}
