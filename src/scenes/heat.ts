/**
 * Turn up the heat. One number, ρ, takes the same equations from stillness through steady
 * rolls into chaos, and on to a window of order beyond it. The film turns the dial with the
 * narration; a drag up or down on the stage turns it by hand.
 */
import * as THREE from 'three'
import { at, easeInOut, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { getSystem } from '../systems'
import { plate } from './kit/hud'
import { FLOOR, lorenzFlow, resetLorenz, silk } from './kit/shared'

function regime(rho: number): string {
  if (rho < 1) return 'stillness'
  if (rho < 24.06) return 'a steady roll'
  if (rho < 24.74) return 'on the brink'
  if (rho > 99.5 && rho < 100.8) return 'a window of order'
  if (rho > 145 && rho < 166) return 'a window of order'
  return 'chaos'
}

const heat: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette } = ctx
  const flow = lorenzFlow(engine)
  const sys = getSystem('lorenz')
  let rho = 28
  let dial: ReturnType<typeof ctx.label> | null = null
  /** seconds the dial has spent where every path settles on a still point */
  let settled = 0
  const rings: ReturnType<typeof ctx.label>[] = []
  const ringAt = [new THREE.Vector3(), new THREE.Vector3()]

  /**
   * Below the threshold every particle comes to rest exactly on a still point, and a point at
   * rest stays there however unstable it has become. Real air is never that still: when the
   * dial passes the threshold again, scatter the particles so they can be thrown off.
   */
  const kick = () => {
    const f = sys.frame(flow.params)
    const look = { ...dust.look }
    dust.setSource(dust.bake(), look)
    flow.spawnCloud(f.center, 1.0 / f.scale)
    sound.sfx('shimmer', 0.35)
    void dust.morphTo(flow, look, { seconds: 1.3, swirl: 0.2 })
  }

  const setRho = (v: number) => {
    const was = rho
    rho = Math.min(170, Math.max(0.2, v))
    flow.setParam(1, rho)
    if (was <= 24.74 && rho > 24.74 && settled > 1.2) {
      settled = 0
      kick()
    }
  }
  const turn = (to: number, seconds: number) => {
    const from = rho
    ctx.tween(seconds, (u) => setRho(from + (to - from) * u), { ease: easeInOut, tag: 'rho' })
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      const look = silk(palette, flow.speedNorm)
      if (dust.source !== flow) {
        resetLorenz(flow)
        void dust.morphTo(flow, look, { seconds: 2.6 })
      } else {
        dust.look.paintMix = 0
      }
      flow.paused = false
      flow.speed = 1
      setRho(28)
      rig.shot({ target: [0, -0.24, 0], distance: 3.75, azimuth: 205, elevation: 11, orbit: 1.6, aperture: 0.004 }, 3)
      dial = plate(ctx, '', '')
      dial.el.classList.add('label--dial')
      for (const p of ringAt) {
        const l = ctx.label('', { kind: 'note', at: p, align: 'center' })
        l.el.classList.add('label--ring')
        rings.push(l)
      }
      ctx.onPointer((e) => {
        // a vertical drag is the dial; a sideways one still orbits the camera
        if (e.type === 'move' && e.pressed && Math.abs(e.dy) > Math.abs(e.dx) * 1.2) {
          e.claim()
          ctx.cancel('rho')
          setRho(rho * Math.exp(-e.dy * 0.006))
        }
      })
    },

    cues: [
      at(2, () => turn(0.6, 2.2)),
      at(3, () => turn(14, 2.6)),
      at(4, () => turn(24.3, Math.max(1.5, ctx.until(4, 'lose their grip') - 0.2))),
      at(4, 'lose their grip', () => turn(28, 2.4)),
      at(6, () => turn(100, Math.max(4, ctx.until(6, 'windows') + 0.8))),
      at(7, () => turn(28, 5.5)),
    ],

    update(dt) {
      dust.look.speedNorm = flow.speedNorm
      settled = rho < 24.06 ? settled + dt : rho > 24.74 ? 0 : settled
      dial?.setHtml(`<i>ρ</i>${rho.toFixed(rho < 10 ? 2 : 1)}<small>${regime(rho)}</small>`)
      const pts = sys.fixedPoints?.(flow.params) ?? []
      const show = pts.length > 1
      for (let i = 0; i < 2; i++) {
        if (show) flow.toWorld(pts[i + 1], ringAt[i])
        rings[i].el.style.opacity = show ? '' : '0'
      }
    },

    exit() {
      ctx.cancel('rho')
    },

    dispose() {
      flow.setParam(1, 28)
    },

    lab: [
      { kind: 'slider', label: 'Heating, ρ', min: 0.2, max: 170, step: 0.05, get: () => rho, set: (v) => {
        ctx.cancel('rho')
        setRho(v)
      }, format: (v) => v.toFixed(2) },
      { kind: 'readout', label: 'Behaviour', get: () => regime(rho) },
      { kind: 'action', label: 'Back to 28', run: () => turn(28, 2) },
    ],
    notes: [
      'The Lorenz equations model a layer of fluid heated from below. The parameter ρ measures how strongly it is heated relative to how readily it conducts.',
      'Below ρ = 1 the fluid conducts heat without moving, and every path ends at the origin. Above it the fluid rolls steadily one way or the other: two fixed points, the eyes. At ρ ≈ 24.74 those rolls become unstable and every path is thrown off them for good.',
      'Further up, chaos is interrupted by windows where the motion locks onto a repeating loop, for instance near ρ = 100. Drag up or down on the picture to turn the dial yourself.',
    ],
  }
}

export default heat
