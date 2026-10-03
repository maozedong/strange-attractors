import type { MandelView } from '../types'

/**
 * Animated flights through the complex plane.
 *
 * Interpolating the centre linearly while the scale shrinks exponentially loses the target: half
 * way from the overview to scale 1e-12 the view is a millionth of a unit wide but the centre is
 * still 0.09 away from the destination, so the picture is blank interior until the last moment.
 * The flight instead follows van Wijk and Nuij's optimal path ("Smooth and efficient zooming
 * and panning", 2003), the geodesic in (centre, log width) space: for a deep zoom it keeps the
 * destination in view and drifts it to the centre as the zoom proceeds, for a long pan at depth
 * it zooms out, travels, and zooms back in. Speed along the path is in perceived units (one
 * unit = one view width of travel or a factor e of zoom), so a pure zoom runs at constant
 * log-scale speed; the parameter is eased in and out over the first and last fifth.
 */

/** van Wijk-Nuij zoom/pan trade-off; their recommended value */
const RHO = 1.42
/** fraction of the flight spent accelerating (and decelerating) */
const RAMP = 0.2

export interface FlightPath {
  /** path length in perceived units; 0 when the views coincide */
  length: number
  /** the view at arc length s ∈ [0, length], written into `out` */
  at(s: number, out: MandelView): MandelView
}

/**
 * The optimal path between two views. `width` converts scale (complex units per render unit)
 * into visible width.
 */
export function flightPath(from: MandelView, to: MandelView, width: number): FlightPath {
  const w0 = from.scale * width
  const w1 = to.scale * width
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  const u1 = Math.hypot(dx, dy)
  const zoom = Math.log(w1 / w0)

  if (u1 <= 1e-9 * Math.min(w0, w1)) {
    // pure zoom (any pan is far below a pixel): log width moves linearly in s
    const length = Math.abs(zoom) / RHO
    return {
      length,
      at(s, out) {
        const k = length > 0 ? s / length : 1
        out.cx = from.cx + dx * k
        out.cy = from.cy + dy * k
        out.scale = (w0 * Math.exp(zoom * k)) / width
        return out
      },
    }
  }

  const r2 = RHO * RHO
  const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * u1 * u1) / (2 * w0 * r2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - r2 * r2 * u1 * u1) / (2 * w1 * r2 * u1)
  // r_i = ln(-b_i + sqrt(b_i^2 + 1)), written stably
  const r0 = -Math.asinh(b0)
  const r1 = -Math.asinh(b1)
  const length = (r1 - r0) / RHO
  const ux = dx / u1
  const uy = dy / u1
  const coshR0 = Math.cosh(r0)
  const coshR1 = Math.cosh(r1)
  return {
    length,
    at(s, out) {
      const x = RHO * s + r0
      const coshX = Math.cosh(x)
      out.scale = (w0 * coshR0) / coshX / width
      // distance travelled, measured from whichever end is nearer so a deep end keeps its digits:
      //   u(s)      = w0/rho^2 * sinh(rho s) / cosh(rho s + r0)
      //   u1 - u(s) = w0/rho^2 * cosh(r0) sinh(r1 - x) / (cosh(r1) cosh(x))
      if (s <= length / 2) {
        const u = ((w0 / r2) * Math.sinh(RHO * s)) / coshX
        out.cx = from.cx + ux * u
        out.cy = from.cy + uy * u
      } else {
        const rest = ((w0 / r2) * coshR0 * Math.sinh(r1 - x)) / (coshR1 * coshX)
        out.cx = to.cx - ux * rest
        out.cy = to.cy - uy * rest
      }
      return out
    },
  }
}

/** Fraction of the path covered at time fraction u: raised-cosine speed ramps, constant between. */
export function flightEase(u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const ramp = (x: number) => (x - (RAMP / Math.PI) * Math.sin((Math.PI * x) / RAMP)) / 2
  const total = 1 - RAMP
  if (u < RAMP) return ramp(u) / total
  if (u > 1 - RAMP) return 1 - ramp(1 - u) / total
  return (RAMP / 2 + (u - RAMP)) / total
}
