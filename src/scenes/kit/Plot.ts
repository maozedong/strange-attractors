/**
 * A small chart drawn on a 2D canvas over the stage, for the one curve a scene needs to show
 * (a gap doubling, a spread widening). No frame, no grid: an axis line, the curve, a few words.
 * Positioned by CSS class (`plot--br` = bottom right, and so on) so phones can move it.
 */
export type PlotCorner = 'br' | 'bl' | 'tr' | 'tl'

export class Plot {
  readonly el: HTMLDivElement
  readonly canvas: HTMLCanvasElement
  readonly g: CanvasRenderingContext2D
  /** drawing size in CSS pixels */
  width: number
  height: number
  private dead = false
  private readonly value: HTMLDivElement

  constructor(host: HTMLElement, corner: PlotCorner, width: number, height: number, caption?: string) {
    this.width = width
    this.height = height
    this.el = document.createElement('div')
    this.el.className = `plot plot--${corner}`
    this.canvas = document.createElement('canvas')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.g = this.canvas.getContext('2d')!
    this.g.scale(dpr, dpr)
    this.value = document.createElement('div')
    this.value.className = 'plot__value'
    this.el.appendChild(this.value)
    this.el.appendChild(this.canvas)
    if (caption) {
      const c = document.createElement('p')
      c.textContent = caption
      this.el.appendChild(c)
    }
    host.appendChild(this.el)
    requestAnimationFrame(() => this.el.classList.add('is-on'))
  }

  /** a live figure shown above the curve */
  setValue(text: string) {
    if (this.value.textContent !== text) this.value.textContent = text
  }

  clear() {
    this.g.clearRect(0, 0, this.width, this.height)
  }

  /** the ink colour of the interface, at a given strength */
  ink(alpha = 1) {
    return `rgba(244, 238, 226, ${alpha})`
  }

  remove() {
    if (this.dead) return
    this.dead = true
    this.el.classList.remove('is-on')
    window.setTimeout(() => this.el.remove(), 700)
  }
}
