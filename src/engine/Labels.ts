/**
 * Words and numbers that live in the scene: a value beside the thing it measures, a name under
 * the shape it belongs to. Each label is a DOM element (so type stays crisp) pinned to a point in
 * the 3D world, or to a place on the screen, and re-projected every frame.
 *
 * Kinds (styled in chrome/film.css):
 *   num    a figure from the data, in the numeral face
 *   note   a short annotation in italic serif
 *   plate  a name plate: title line and a smaller second line
 *   big    one large figure the whole scene is about
 */
import * as THREE from 'three'

export type LabelKind = 'num' | 'note' | 'plate' | 'big'

export interface LabelOptions {
  kind?: LabelKind
  /** world position, a function returning one (for moving things), or screen fractions */
  at: THREE.Vector3 | [number, number, number] | (() => THREE.Vector3) | { screen: [number, number] }
  /** where the text sits relative to its anchor */
  align?: 'left' | 'right' | 'center' | 'above' | 'below'
  /** pixel offset from the anchor */
  dx?: number
  dy?: number
  /** draw a short leader line from the anchor to the text */
  leader?: boolean
}

export interface Label {
  set(text: string): void
  setHtml(html: string): void
  move(at: LabelOptions['at']): void
  /** fade out and remove */
  remove(): void
  readonly el: HTMLElement
}

interface Item {
  el: HTMLElement
  at: LabelOptions['at']
  dx: number
  dy: number
  dead: boolean
}

const v = new THREE.Vector3()

export class Labels {
  readonly root: HTMLElement
  private readonly items = new Set<Item>()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'labels'
    this.root.setAttribute('aria-hidden', 'true')
    parent.appendChild(this.root)
  }

  add(text: string, opts: LabelOptions): Label {
    const el = document.createElement('div')
    el.className = `label label--${opts.kind ?? 'note'} label--${opts.align ?? 'left'}${opts.leader ? ' label--leader' : ''}`
    const span = document.createElement('span')
    span.textContent = text
    el.appendChild(span)
    this.root.appendChild(el)
    const item: Item = { el, at: opts.at, dx: opts.dx ?? 0, dy: opts.dy ?? 0, dead: false }
    // the leader line is drawn in CSS from these
    el.style.setProperty('--dx', `${item.dx}px`)
    el.style.setProperty('--dy', `${item.dy}px`)
    this.items.add(item)
    // next frame, so the transition runs
    requestAnimationFrame(() => el.classList.add('is-on'))
    return {
      el,
      set: (t) => {
        if (span.textContent !== t) span.textContent = t
      },
      setHtml: (h) => {
        span.innerHTML = h
      },
      move: (at) => {
        item.at = at
      },
      remove: () => {
        if (item.dead) return
        item.dead = true
        el.classList.remove('is-on')
        window.setTimeout(() => {
          el.remove()
          this.items.delete(item)
        }, 700)
      },
    }
  }

  /** remove every label (scene change) */
  clear() {
    for (const item of this.items) {
      if (item.dead) continue
      item.dead = true
      item.el.classList.remove('is-on')
      const el = item.el
      window.setTimeout(() => {
        el.remove()
        this.items.delete(item)
      }, 700)
    }
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number) {
    for (const item of this.items) {
      const at = item.at
      let x: number
      let y: number
      let hidden = false
      if (typeof at === 'object' && 'screen' in at) {
        x = at.screen[0] * width
        y = at.screen[1] * height
      } else {
        if (typeof at === 'function') v.copy(at())
        else if (Array.isArray(at)) v.set(at[0], at[1], at[2])
        else v.copy(at)
        v.project(camera)
        hidden = v.z > 1 || v.z < -1
        x = (v.x * 0.5 + 0.5) * width
        y = (-v.y * 0.5 + 0.5) * height
      }
      item.el.style.transform = `translate3d(${(x + item.dx).toFixed(1)}px, ${(y + item.dy).toFixed(1)}px, 0)`
      item.el.style.visibility = hidden ? 'hidden' : 'visible'
    }
  }
}
