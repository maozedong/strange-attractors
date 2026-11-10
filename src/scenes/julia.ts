/**
 * A fractal in every point. The Mandelbrot set lies on the floor beside a second plane that
 * shows the Julia set of one point c of it, marked by a ring. The dust settles on that Julia set
 * (each particle runs the map backwards), so when c steps outside the Mandelbrot set the shape
 * and the dust shatter together. At the end the visitor can drag c themselves.
 */
import * as THREE from 'three'
import { at, easeInOut, linear, type SceneFactory } from '../film/types'
import { sound } from '../sound/audio'
import { ComplexPlane } from './kit/ComplexPlane'
import { plate, readout } from './kit/hud'
import { JuliaDust } from './kit/JuliaDust'
import { FLOOR, ink } from './kit/shared'

const PLANE_Y = FLOOR + 0.002
/** each plane, world units (the far field is transparent; only the middle shows) */
const PLANE_W = 3.0
const PLANE_H = 2.8
/** complex units per world unit on each plane */
const M_SCALE = 1.08
const J_SCALE = 1.3

const PLACES = {
  start: [-0.52, 0.06],
  rabbit: [-0.123, 0.745],
  dust: [0.43, 0.6],
  spirals: [-0.835, 0.2321],
  lightning: [0, 1],
  seahorses: [-0.75, 0.11],
  basilica: [-1, 0],
  siegel: [-0.390540870218, -0.586787907347],
} satisfies Record<string, [number, number]>
type Place = keyof typeof PLACES

const minus = (x: number, digits: number) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(digits)
const formatC = (c: THREE.Vector2) => `c = ${minus(c.x, 3)} ${c.y < 0 ? '−' : '+'} ${Math.abs(c.y).toFixed(3)}i`

/** c lies in the Mandelbrot set (to a few hundred iterations) */
function inside(c: THREE.Vector2): boolean {
  let x = 0
  let y = 0
  for (let n = 0; n < 500; n++) {
    const nx = x * x - y * y + c.x
    y = 2 * x * y + c.y
    x = nx
    if (x * x + y * y > 4) return false
  }
  return true
}

/** a point on the rim of the main cardioid at parameter t, pushed `gap` outward along its normal */
function onCardioid(t: number, gap: number): [number, number] {
  const x = Math.cos(t) / 2 - Math.cos(2 * t) / 4
  const y = Math.sin(t) / 2 - Math.sin(2 * t) / 4
  const dx = -Math.sin(t) / 2 + Math.sin(2 * t) / 2
  const dy = Math.cos(t) / 2 - Math.cos(2 * t) / 2
  const l = Math.hypot(dx, dy) || 1
  return [x + (dy / l) * gap, y - (dx / l) * gap]
}

const julia: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx
  const density = ctx.size >= 512 ? 420 : 240
  const mPlane = new ComplexPlane(engine.renderer, palette, 'mandel', PLANE_W, PLANE_H, { cx: -0.75, cy: 0, scale: M_SCALE }, { density })
  const jPlane = new ComplexPlane(engine.renderer, palette, 'julia', PLANE_W, PLANE_H, { cx: 0, cy: 0, scale: J_SCALE }, { density })
  for (const p of [mPlane, jPlane]) {
    p.mesh.rotation.x = -Math.PI / 2
    p.uniforms.uOpacity.value = 0
    root.add(p.mesh)
  }
  mPlane.maxIter = 400
  // the Julia sets near the border are fine dust: a thinner core and stronger bands show their spirals
  jPlane.uniforms.uFine.value = 1.2
  jPlane.uniforms.uReach.value = 0.05
  jPlane.uniforms.uBand.value = 0.6
  const jd = new JuliaDust(engine.renderer, ctx.size)
  jd.lift = 0.1

  const c = new THREE.Vector2(...PLACES.start)
  let place: Place = 'start'
  let portrait = false
  let ring: ReturnType<typeof ctx.label> | null = null
  let hint: ReturnType<typeof ctx.label> | null = null
  let figure: ReturnType<typeof ctx.label> | null = null
  let name: ReturnType<typeof ctx.label> | null = null
  /** dragging is open to the visitor */
  let free = false
  let dragging = false
  let wasInside = true
  const ringAt = new THREE.Vector3()
  let lastFrame = performance.now()
  let labWas = false

  /** side by side on a wide frame; the Mandelbrot set above the Julia set on a tall one */
  const layout = () => {
    portrait = ctx.portrait
    const m = portrait ? new THREE.Vector3(0, PLANE_Y, -1.32) : new THREE.Vector3(-1.32, PLANE_Y, 0)
    const j = portrait ? new THREE.Vector3(0, PLANE_Y, 1.32) : new THREE.Vector3(1.32, PLANE_Y, 0)
    mPlane.mesh.position.copy(m)
    jPlane.mesh.position.copy(j)
    jd.matrix.makeTranslation(j.x, PLANE_Y + 0.004, j.z).multiply(new THREE.Matrix4().makeScale(1 / J_SCALE, 1, 1 / J_SCALE))
  }

  const dustLook = () => ({ ...ink(palette, 0.55), tone: 'aux' as const, toneBias: 0.45, toneScale: 0.5, size: 0.0021, minPx: 0.5, gain: 0.08, twinkle: 0.4 })

  /** glide c to a point over `seconds` */
  const glide = (to: [number, number], seconds: number, ease = easeInOut) => {
    const from = c.clone()
    ctx.tween(seconds, (u) => c.set(from.x + (to[0] - from.x) * u, from.y + (to[1] - from.y) * u), { ease, tag: 'c' })
  }
  const go = (p: Place, seconds: number) => {
    place = p
    glide(PLACES[p], seconds)
  }

  /** walk c along the edge of the main cardioid, just outside it, from angle t0 to t1, then on to a place */
  const walk = (t0: number, t1: number, seconds: number, then: Place) => {
    const from = c.clone()
    const end = PLACES[then]
    ctx.tween(
      seconds,
      (u) => {
        // in from wherever c is, along the rim, out to the place
        const t = t0 + (t1 - t0) * u
        const [bx, by] = onCardioid(t, -0.006)
        const a = Math.min(1, u / 0.18)
        const b = Math.max(0, (u - 0.82) / 0.18)
        const ea = a * a * (3 - 2 * a)
        const eb = b * b * (3 - 2 * b)
        let x = from.x + (bx - from.x) * ea
        let y = from.y + (by - from.y) * ea
        x += (end[0] - x) * eb
        y += (end[1] - y) * eb
        c.set(x, y)
      },
      { ease: linear, tag: 'c' },
    )
    place = then
  }

  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const hitPoint = new THREE.Vector3()
  const pick = (x: number, y: number): THREE.Vector2 | null => {
    ndc.set(x, y)
    ray.setFromCamera(ndc, rig.camera)
    if (!mPlane.hit(ray.ray, hitPoint)) return null
    const z = mPlane.toComplex(hitPoint)
    if (z.x < -2.1 || z.x > 0.7 || Math.abs(z.y) > 1.3) return null
    return z
  }

  return {
    enter() {
      dust.floorY = FLOOR
      engine.backdrop.floor = 1
      layout()
      // after the last scene's plane has mostly gone
      ctx.after(0.9, () =>
        ctx.fade(2.6, 0, 1, (v) => {
          mPlane.uniforms.uOpacity.value = v
          jPlane.uniforms.uOpacity.value = v
        }),
      )
      jd.c.copy(c)
      if (dust.morphing) dust.setSource(dust.bake(), { ...dust.look })
      void dust.morphTo(jd, dustLook(), { seconds: 3, swirl: 0.6 })
      rig.shot(
        { target: [0, FLOOR, 0.12], distance: 5.15, azimuth: 0, elevation: 64, orbit: 0, aperture: 0.003, fov: 38, portrait: { target: [0, FLOOR, 0.5], distance: 3.5, elevation: 72 } },
        3.2,
      )
      ring = ctx.label('', { kind: 'note', at: () => mPlane.toWorld(c.x, c.y, ringAt), align: 'center' })
      ring.el.classList.add('label--ring')
      figure = readout(ctx)
      ctx.onPointer((e) => {
        if (!free && !ctx.lab) return
        if (e.type === 'down') {
          const z = pick(e.x, e.y)
          if (!z) return
          e.claim()
          dragging = true
          ctx.cancel('c')
          c.copy(z)
          hint?.remove()
          hint = null
        } else if (e.type === 'move' && dragging && e.pressed) {
          e.claim()
          const z = pick(e.x, e.y)
          if (z) c.copy(z)
        } else if (e.type === 'up') {
          dragging = false
        }
      })
    },

    cues: [
      at(1, 'Choose a point', () => {
        go('rabbit', Math.max(1.5, ctx.until(1, 'shape') + 0.2))
        rig.shot({ distance: 4.85, portrait: { distance: 3.4, elevation: 72 } }, 7)
      }),
      // the shape breathes while c wanders a little inside the rabbit's bulb
      at(2, () => {
        const [x0, y0] = PLACES.rabbit
        ctx.tween(
          Math.max(2, ctx.until(3) - 0.2),
          (u) => {
            const a = u * Math.PI * 2
            const r = 0.035 * Math.sin(u * Math.PI)
            c.set(x0 + r * Math.cos(a) - r, y0 + r * Math.sin(a))
          },
          { ease: linear, tag: 'c' },
        )
      }),
      at(3, 'Step over', () => {
        go('dust', Math.max(1.2, ctx.until(3, 'shatters') + 0.25))
        if (!ctx.portrait) rig.shot({ target: [0.35, FLOOR, 0.1], distance: 4.6 }, 3)
      }),
      at(4, 'Walk along', () => rig.shot({ target: [0, FLOOR, 0.12], distance: 5.0, portrait: { target: [0, FLOOR, 0.5], distance: 3.5 } }, 3.5)),
      at(4, 'Walk along', () => walk(1.15, Math.PI - 0.62, Math.max(2, ctx.until(4, 'Spirals') + 0.05), 'spirals')),
      at(4, 'Lightning', -0.4, () => go('lightning', 0.6)),
      at(4, 'Seahorses', -0.4, () => go('seahorses', 0.65)),
      at(5, () => {
        name = plate(ctx, 'Gaston Julia', 'Paris, 1918')
      }),
      at(6, () => {
        rig.shot({ distance: 5.5, elevation: 60, orbit: 0.8, portrait: { distance: 3.7, elevation: 70 } }, 6)
      }),
      at('end', () => {
        name?.remove()
        free = true
        hint = ctx.label('drag me', { kind: 'note', at: () => mPlane.toWorld(c.x, c.y, ringAt), align: 'right', dx: 22 })
      }),
    ],

    explore() {
      // the rabbit to start with, and c is the visitor's to drag (dragging is open whenever the drawer is)
      ctx.after(1.2, () => {
        go('rabbit', 1.6)
        hint = ctx.label('drag me', { kind: 'note', at: () => mPlane.toWorld(c.x, c.y, ringAt), align: 'right', dx: 22 })
      })
    },

    update(dt) {
      if (ctx.portrait !== portrait) layout()
      // the lab drawer narrows the frame (the rig shifts the picture into the open part): step back so both planes fit
      if (ctx.lab !== labWas) {
        labWas = ctx.lab
        if (!ctx.portrait) rig.shot(labWas ? { target: [0, FLOOR, 0.12], distance: 6.6, elevation: 64 } : { target: [0, FLOOR, 0.12], distance: 5.0, elevation: 64 }, 1.6)
      }
      mPlane.c.copy(c)
      jPlane.c.copy(c)
      jd.c.copy(c)
      figure?.set(formatC(c))
      // a quiet sound when c crosses the edge of the set
      const now = inside(c)
      if (now !== wasInside) {
        wasInside = now
        sound.note(now ? 523.25 : 392, { gain: 0.08, seconds: 1.2 })
      }
      const t = performance.now()
      const real = Math.min(0.1, (t - lastFrame) / 1000)
      lastFrame = t
      mPlane.update(dt, real)
      jPlane.update(dt, real)
    },

    exit() {
      ctx.cancel('c')
      const o = mPlane.uniforms.uOpacity.value
      ctx.tween(2.6, (u) => {
        mPlane.uniforms.uOpacity.value = o * (1 - u)
        jPlane.uniforms.uOpacity.value = o * (1 - u)
      })
    },

    dispose() {
      mPlane.dispose()
      jPlane.dispose()
      jd.dispose()
    },

    lab: [
      {
        kind: 'choice',
        label: 'Choose c',
        options: [
          { value: 'rabbit', label: 'Douady’s rabbit' },
          { value: 'basilica', label: 'Basilica' },
          { value: 'siegel', label: 'Siegel disc' },
          { value: 'spirals', label: 'Spirals' },
          { value: 'lightning', label: 'Lightning' },
          { value: 'seahorses', label: 'Seahorses' },
          { value: 'dust', label: 'Outside: dust' },
        ],
        get: () => place,
        set: (v) => go(v as Place, 1.6),
      },
      { kind: 'readout', label: 'c', get: () => formatC(c).slice(4) },
      { kind: 'readout', label: 'Julia set', get: () => (inside(c) ? 'in one piece' : 'dust') },
    ],
    notes: [
      'Every point c gives the rule z → z² + c, and the rule sorts the starting points z into those that stay small forever and those that run off to infinity. The boundary between the two is the Julia set of c. The Mandelbrot set is an index of all of them: c lies in it exactly when its Julia set is connected, one piece.',
      'Outside the Mandelbrot set the Julia set is a Cantor dust, infinitely many points and no two joined. Near the boundary of the Mandelbrot set the Julia set takes on the local look of the Mandelbrot set around c: spirals in seahorse valley, branching lightning at the tip of an antenna.',
      'The dust here finds each Julia set by running the rule backwards, z ← ±√(z − c), choosing the sign at random: backwards, the Julia set attracts. Gaston Julia worked all of this out in 1918, recovering from a war wound, without ever seeing a single picture of it. Drag the ring to choose c yourself.',
    ],
  }
}


export default julia
