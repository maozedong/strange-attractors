import { useStore } from '../../store'
import type { MandelView } from '../types'
import { flightEase, flightPath } from './flight'
import { clampScale } from './orbit'

/** Width of the mounted Mandelbrot plane in render units; flights measure distance in visible widths. */
let viewWidth = 4

/** Called by MandelbrotPlane on mount and when its width changes. */
export function setFlightViewWidth(width: number): void {
  if (width > 0) viewWidth = width
}

let activeCancel: (() => void) | null = null

/** Stop the flight in progress, if any; the view stays where it is. */
export function cancelMandelFlight(): void {
  activeCancel?.()
}

/**
 * Fly the store's Mandelbrot view from where it is to `target` over `seconds`, writing through
 * `setFractal` each animation frame. Starting a flight cancels the previous one, and so does
 * any other write to `fractal.mandel` (a chapter reset, a gesture on the plane). Returns a
 * cancel function.
 */
export function animateMandelTo(target: MandelView, seconds: number): () => void {
  cancelMandelFlight()
  const { fractal, setFractal } = useStore.getState()
  const from: MandelView = { ...fractal.mandel }
  const to: MandelView = { cx: target.cx, cy: target.cy, scale: clampScale(target.scale) }
  const path = flightPath(from, to, viewWidth)

  if (!(seconds > 0) || path.length === 0 || typeof requestAnimationFrame !== 'function') {
    setFractal({ mandel: to })
    return () => {}
  }

  let raf = 0
  let done = false
  /** the view this flight last wrote; anything else in the store means someone else took over */
  let written: MandelView = useStore.getState().fractal.mandel
  const start = performance.now()
  const cancel = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    if (activeCancel === cancel) activeCancel = null
  }
  const step = (now: number) => {
    if (done) return
    // a chapter reset, a jump or a gesture wrote the view: yield to it
    if (useStore.getState().fractal.mandel !== written) {
      cancel()
      return
    }
    const u = (now - start) / (seconds * 1000)
    if (u >= 1) {
      setFractal({ mandel: to })
      cancel()
      return
    }
    // a fresh object per frame: store subscribers compare by reference
    written = path.at(flightEase(u) * path.length, { cx: 0, cy: 0, scale: 1 })
    setFractal({ mandel: written })
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  activeCancel = cancel
  return cancel
}
