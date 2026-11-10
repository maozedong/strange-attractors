/**
 * The moon that tumbles. Saturn, its rings made of dust on Kepler orbits, and Hyperion: a
 * potato-shaped moon turned by Saturn's tidal pull on a stretched orbit (rigid-body dynamics
 * from the old stage, Wisdom, Peale & Mignard 1984). The camera rides alongside it in the frame
 * that turns with its orbit, where a well-behaved moon would hold still and this one tumbles.
 * A ghost twin started a tenth of a degree apart keeps it company until, a few months on, the
 * two face different ways.
 */
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { defaultLook, type DustLook } from '../../engine/Dust'
import { rampColor } from '../../engine/palettes'
import { at, easeInOut, type SceneFactory } from '../../film/types'
import { sound } from '../../sound/audio'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { HYPERION_DT, HYPERION_ECCENTRICITY, HYPERION_PERIOD_DAYS, createPair, orbitPosition, resetPair } from '../../world/hyperion/dynamics'
import { releaseSource } from '../kit/FragmentSource'
import { plate, readout } from '../kit/hud'
import { MOON_SCALE, createMoons, createSaturn } from './bodies'
import { createRings } from './rings'

const TAU = Math.PI * 2
const DEG = Math.PI / 180
/** semi-major axis of Hyperion's drawn orbit, world units (not to scale: the real one is 24.6 Saturn radii) */
const ORBIT_A = 2.05
/** the orbit's periapsis direction, turned so the moon starts in front of the planet */
const PERI = -128 * DEG
/** RK4 steps per frame at most; beyond it the clock lags rather than stalling the frame */
const MAX_STEPS = 260
/** where the ghost twin is drawn: this far to the camera's right of the moon */
const TWIN_GAP = -0.26

interface CamState {
  target: THREE.Vector3
  distance: number
  azimuth: number
  elevation: number
  fov: number
  aperture: number
}

const makeCam = (): CamState => ({ target: new THREE.Vector3(), distance: 4, azimuth: 0, elevation: 15, fov: 38, aperture: 0.002 })

const hyperion: SceneFactory = (ctx) => {
  const { engine, dust, rig, palette, root } = ctx

  // ---- the system
  const system = new THREE.Group()
  root.add(system)
  const saturn = createSaturn()
  system.add(saturn.mesh)
  const moons = createMoons()
  root.add(moons.moon, moons.ghost)
  moons.ghostMaterial.uniforms.uColor.value.copy(rampColor(palette, 0.3)).multiplyScalar(2.0)
  const rings = createRings(engine.renderer, ctx.size)
  const ringGain = 0.3
  const ringLook: DustLook = {
    ...defaultLook(palette),
    size: 0.0036,
    minPx: 0.6,
    gain: 0.3,
    streak: 0.25,
    tone: 'aux',
    toneBias: 0.04,
    toneScale: 0.9,
    twinkle: 0,
  }

  // the orbit, drawn faintly
  const orbitFrame = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), PERI)
  const dynToStage = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
  const orbitPts: number[] = []
  {
    const e = HYPERION_ECCENTRICITY
    const b = ORBIT_A * Math.sqrt(1 - e * e)
    const v = new THREE.Vector3()
    for (let i = 0; i <= 512; i++) {
      const E = (i / 512) * TAU
      v.set(ORBIT_A * (Math.cos(E) - e), 0, -b * Math.sin(E)).applyQuaternion(orbitFrame)
      orbitPts.push(v.x, v.y, v.z)
    }
  }
  const orbitGeometry = new LineGeometry()
  orbitGeometry.setPositions(orbitPts)
  const orbitMaterial = createTrajectoryLineMaterial(1.1)
  orbitMaterial.vertexColors = false
  orbitMaterial.depthTest = true
  const orbitInk = rampColor(palette, 0.7)
  const orbitLine = new Line2(orbitGeometry, orbitMaterial)
  orbitLine.frustumCulled = false
  orbitLine.renderOrder = 3
  root.add(orbitLine)
  let orbitOpacity = 0
  const setOrbitOpacity = (v: number) => {
    orbitOpacity = v
    orbitMaterial.color.copy(orbitInk).multiplyScalar(0.32 * v)
    orbitLine.visible = v > 0.002
  }
  setOrbitOpacity(0)

  // a needle through each body along its long axis, so the eye can compare which way they face
  const needleLength = 0.26 * MOON_SCALE * 1.75
  const needleGeometry = new LineGeometry()
  needleGeometry.setPositions([-needleLength, 0, 0, needleLength, 0, 0])
  const needleInk = [rampColor(palette, 0.86).multiplyScalar(0.9), rampColor(palette, 0.3).multiplyScalar(1.6)]
  const needleMaterials = needleInk.map(() => {
    const m = createTrajectoryLineMaterial(1.3)
    m.vertexColors = false
    m.depthTest = true
    return m
  })
  const needles = needleMaterials.map((m) => {
    const l = new Line2(needleGeometry, m)
    l.frustumCulled = false
    l.renderOrder = 13
    return l
  })
  moons.moon.add(needles[0])
  moons.ghost.add(needles[1])
  let needleOpacity = 0
  const setNeedles = (v: number) => {
    needleOpacity = v
    needleMaterials[0].color.copy(needleInk[0]).multiplyScalar(v * opacity)
    needleMaterials[1].color.copy(needleInk[1]).multiplyScalar(v * opacity * twinShown)
    needles[0].visible = v * opacity > 0.002
  }

  // ---- the dynamics
  const sim = createPair()
  let orbitsGoal = 0
  /** orbits per second while not being paced to a word */
  let rate = 0.1
  let pacing = false
  let twin = false
  const pos = new Float64Array(2)
  const q = new Float64Array(4)
  const qd = new THREE.Quaternion()
  const moonPos = new THREE.Vector3()
  const twinPos = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const seeMoon = new THREE.Vector3()
  const seeTwin = new THREE.Vector3()

  const orbits = () => sim.t / TAU
  const placeMoons = () => {
    orbitPosition(sim.t, HYPERION_ECCENTRICITY, ORBIT_A, pos)
    moonPos.set(pos[0], 0, -pos[1]).applyQuaternion(orbitFrame)
    moons.moon.position.copy(moonPos)
    sim.quaternion(0, q)
    moons.moon.quaternion.copy(orbitFrame).multiply(dynToStage).multiply(qd.set(q[1], q[2], q[3], q[0]))
    // the twin shares the moon's place on the orbit; draw it beside the moon, across the view,
    // turned so the camera sees it from the same side as the moon (a fair comparison)
    const right = rightOf(rig.camera)
    twinPos.copy(moonPos).addScaledVector(right, TWIN_GAP * twinShown)
    moons.ghost.position.copy(twinPos)
    camPos.setFromMatrixPosition(rig.camera.matrixWorld)
    seeMoon.subVectors(moonPos, camPos).normalize()
    seeTwin.subVectors(twinPos, camPos).normalize()
    sim.quaternion(1, q)
    moons.ghost.quaternion.setFromUnitVectors(seeMoon, seeTwin).multiply(orbitFrame).multiply(dynToStage).multiply(qd.set(q[1], q[2], q[3], q[0]))
    mid.copy(moonPos).addScaledVector(right, 0.5 * TWIN_GAP * twinShown)
  }
  const rightV = new THREE.Vector3()
  const rightOf = (cam: THREE.Camera) => rightV.setFromMatrixColumn(cam.matrixWorld, 0).normalize()

  const startOver = () => {
    resetPair(sim)
    orbitsGoal = 0
    pacing = false
    ctx.cancel('orbits')
    placeMoons()
  }

  // ---- light: one key, upper left of the frame, toward the camera; the same for every body
  const sunWorld = new THREE.Vector3(-0.6, 0.45, 0.6).normalize()
  const camRight = new THREE.Vector3()
  const camUp = new THREE.Vector3()
  const camBack = new THREE.Vector3()
  const invSystem = new THREE.Quaternion()
  const camLocal = new THREE.Vector3()
  const lightTo = (out: THREE.Vector3) => {
    const m = rig.camera.matrixWorld
    camRight.setFromMatrixColumn(m, 0)
    camUp.setFromMatrixColumn(m, 1)
    camBack.setFromMatrixColumn(m, 2)
    // never let the key drop below the ring plane: the rings' lit face must stay toward us
    out.set(0, 0, 0).addScaledVector(camRight, -0.72).addScaledVector(camUp, 0.5).addScaledVector(camBack, 0.48)
    out.y = Math.max(out.y, 0.32 * out.length())
    return out.normalize()
  }

  // ---- the camera: a wide view of the planet, or riding in the frame that turns with the orbit
  const wide = makeCam()
  const ride = makeCam()
  const shown = makeCam()
  let wideAz = 18
  const wideSpec = { distance: 4.7, elevation: 17, orbit: 1.1 }
  const rideSpec = { distance: 0.56, elevation: 10, side: -34, up: 0.0, pull: 0 }
  let rideMix = 0
  let twinShown = 0
  let free = false
  const radial = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const look = new THREE.Vector3()
  const Y = new THREE.Vector3(0, 1, 0)

  const computeWide = (dt: number) => {
    if (free) wideAz += dt * wideSpec.orbit
    wide.target.set(0, -0.14, 0)
    // a tall frame pulls back by itself to fit the width; the rings can afford to fill it
    wide.distance = wideSpec.distance * (ctx.portrait ? 0.66 : 1)
    wide.azimuth = wideAz
    wide.elevation = wideSpec.elevation
    wide.fov = 38
    wide.aperture = 0.0015
  }
  const computeRide = () => {
    radial.copy(moonPos).setY(0).normalize()
    tangent.crossVectors(Y, radial)
    const side = rideSpec.side * DEG
    const el = rideSpec.elevation * DEG
    // from the target out toward the camera: outward from Saturn, swung back along the orbit
    look
      .copy(radial)
      .multiplyScalar(Math.cos(side))
      .addScaledVector(tangent, -Math.sin(side))
      .multiplyScalar(Math.cos(el))
      .addScaledVector(Y, Math.sin(el))
    ride.target.copy(mid).multiplyScalar(1 - rideSpec.pull)
    ride.target.y += rideSpec.up
    ride.distance = rideSpec.distance
    ride.azimuth = Math.atan2(look.x, look.z) / DEG
    ride.elevation = Math.asin(Math.max(-1, Math.min(1, look.y))) / DEG
    ride.fov = 38
    ride.aperture = 0.0022
  }
  const blendCam = (k: number) => {
    const e = k
    shown.target.lerpVectors(wide.target, ride.target, e)
    shown.distance = Math.exp(Math.log(wide.distance) + (Math.log(ride.distance) - Math.log(wide.distance)) * e)
    let da = ride.azimuth - wide.azimuth
    da = ((((da + 180) % 360) + 360) % 360) - 180
    shown.azimuth = wide.azimuth + da * e
    shown.elevation = wide.elevation + (ride.elevation - wide.elevation) * e
    shown.fov = wide.fov + (ride.fov - wide.fov) * e
    shown.aperture = wide.aperture + (ride.aperture - wide.aperture) * e
    // the wide view's azimuth follows wherever we left the ride, so pulling back has no swing
    if (k > 0.999) wideAz = ride.azimuth
  }
  const toRide = (seconds: number) => ctx.tween(seconds, (u) => (rideMix = u), { ease: easeInOut, tag: 'cam' })
  const toWide = (seconds: number) => {
    const from = rideMix
    ctx.tween(seconds, (u) => (rideMix = from * (1 - u)), { ease: easeInOut, tag: 'cam' })
  }
  const rideTo = (spec: Partial<typeof rideSpec>, seconds: number) => {
    const from = { ...rideSpec }
    ctx.tween(
      seconds,
      (u) => {
        for (const k of Object.keys(spec) as (keyof typeof rideSpec)[]) rideSpec[k] = from[k] + ((spec[k] ?? from[k]) - from[k]) * u
      },
      { ease: easeInOut, tag: 'ride' },
    )
  }

  let name: ReturnType<typeof ctx.label> | null = null
  let figures: ReturnType<typeof ctx.label> | null = null
  let opacity = 0
  const setProps = (v: number) => {
    opacity = v
    saturn.opacity = v
    moons.moonOpacity = v
  }
  const setTwin = (on: boolean, seconds = 1.2) => {
    twin = on
    const from = twinShown
    ctx.tween(seconds, (u) => {
      twinShown = from + ((on ? 1 : 0) - from) * u
      moons.ghostOpacity = twinShown * opacity
    }, { ease: easeInOut, tag: 'twin' })
  }

  const showFigures = () => {
    if (!figures) figures = readout(ctx)
  }

  return {
    enter() {
      dust.floorY = null
      engine.backdrop.floor = 0
      engine.backdrop.level = 0.55
      rings.source.run()
      void dust.morphTo(rings.source, ringLook, { seconds: 3.2, swirl: 0.9 })
      // the planet arrives once the dust has begun to leave the previous picture
      setProps(0)
      ctx.after(0.9, () => ctx.fade(2.4, 0, 1, setProps))
      placeMoons()
      computeWide(0)
      rig.shot({ target: [0, -0.14, 0], distance: wideSpec.distance, azimuth: wideAz, elevation: wideSpec.elevation, fov: 38, orbit: 0, aperture: 0.0015 }, 2.8)
      // the scripted shot eases in; from then on this scene drives the camera every frame
      ctx.after(2.8, () => (free = true))
    },

    cues: [
      at(1, () => {
        free = true
        toRide(3.4)
        name = plate(ctx, 'Hyperion', '360 × 266 × 205 km')
      }),
      // watch it tumble: pace the orbits so the twin arrives where the two still agree
      at(2, () => {
        rate = Math.min(0.4, Math.max(0.12, (3.9 - orbits()) / Math.max(1, ctx.until(4))))
      }),
      // its orbit is stretched: rise to see the ellipse round the planet
      at(3, () => {
        name?.remove()
        name = null
        rideTo({ distance: 3.0, elevation: 36, side: -48, pull: 0.45 }, 3.4)
        ctx.fade(2, orbitOpacity, 1, setOrbitOpacity)
      }),
      at(4, () => {
        rate = Math.max(0.03, (4.15 - orbits()) / Math.max(1, ctx.until(5)))
        setTwin(true, 1.4)
        ctx.fade(1.4, needleOpacity, 1, setNeedles)
        sound.sfx('split', 0.45)
        rideTo({ distance: 0.74, elevation: 12, side: -28, pull: 0 }, 3.0)
        ctx.fade(2, orbitOpacity, 0.35, setOrbitOpacity)
      }),
      // a few months: run the clock so they part company just as the narrator moves on
      at(5, () => {
        showFigures()
        sound.sfx('rise', 0.5)
        pacing = true
        const from = orbitsGoal
        const to = 8.0
        ctx.tween(Math.max(1.6, ctx.until(6) + 1.1), (u) => (orbitsGoal = from + (to - from) * u), {
          ease: easeInOut,
          tag: 'orbits',
          done: () => {
            pacing = false
            rate = 0.05
          },
        })
      }),
      at(7, () => {
        toWide(5.5)
        ctx.fade(3, orbitOpacity, 0.8, setOrbitOpacity)
      }),
    ],

    explore() {
      // both moons tumbling at a watchable pace, wide on Saturn; the camera and clock are in the drawer
      pacing = false
      rate = 0.5
      ctx.after(2.6, () => {
        setTwin(true, 0.8)
        showFigures()
        ctx.fade(0.8, needleOpacity, 1, setNeedles)
      })
    },

    update(dt) {
      // the clock
      if (!pacing && (ctx.time > 0 || ctx.lab)) orbitsGoal += dt * rate
      const want = Math.floor((orbitsGoal * TAU) / HYPERION_DT)
      const n = Math.min(MAX_STEPS, Math.max(0, want - sim.steps))
      if (n > 0) sim.advance(n)
      if (want - sim.steps > MAX_STEPS * 4) orbitsGoal = orbits()

      // the camera
      computeWide(dt)
      placeMoons()
      computeRide()
      blendCam(rideMix)
      if (free) {
        rig.shot(
          { target: [shown.target.x, shown.target.y, shown.target.z], distance: shown.distance, azimuth: shown.azimuth, elevation: shown.elevation, fov: shown.fov, aperture: shown.aperture, orbit: 0 },
          0,
        )
      }

      // the light
      lightTo(sunWorld)
      moons.light.copy(sunWorld)
      moons.moonMaterial.uniforms.uFillDir.value.copy(moonPos).negate().normalize()
      moons.moon.updateMatrixWorld()
      moons.moonMaterial.uniforms.uRot.value.setFromMatrix4(moons.moon.matrixWorld)
      system.updateMatrixWorld()
      invSystem.copy(system.quaternion).invert()
      saturn.material.uniforms.uLight.value.copy(sunWorld).applyQuaternion(invSystem)
      rings.light.copy(sunWorld).applyQuaternion(invSystem)
      rings.source.matrix.copy(system.matrixWorld)
      // seen edge-on the ring piles every particle into a line: dim it as it closes
      camLocal.setFromMatrixPosition(rig.camera.matrixWorld).applyQuaternion(invSystem)
      const open = Math.abs(camLocal.y) / Math.max(1e-3, camLocal.length())
      ringLook.gain = ringGain * Math.min(1, Math.max(0.1, open / 0.3))
      for (const m of [orbitMaterial, ...needleMaterials]) setLinePixelRatio(m, engine.renderer.getPixelRatio())

      if (twin || twinShown > 0) moons.ghostOpacity = twinShown * opacity
      setNeedles(needleOpacity)
      if (figures) {
        const days = orbits() * HYPERION_PERIOD_DAYS
        const apart = (sim.longAxisAngle(0, 1) * 180) / Math.PI
        figures.set(`day ${days.toFixed(0)} apart by ${apart < 10 ? apart.toFixed(1) : apart.toFixed(0)}°`)
      }
    },

    exit() {
      engine.backdrop.level = 1
      ctx.fade(2.2, opacity, 0, setProps)
      ctx.fade(1.6, twinShown, 0, (v) => (moons.ghostOpacity = v * opacity))
      ctx.fade(1.6, orbitOpacity, 0, setOrbitOpacity)
      ctx.fade(1.6, needleOpacity, 0, setNeedles)
      free = false
    },

    dispose() {
      saturn.dispose()
      moons.dispose()
      orbitGeometry.dispose()
      orbitMaterial.dispose()
      needleGeometry.dispose()
      for (const m of needleMaterials) m.dispose()
      releaseSource(dust, rings.source, () => rings.dispose())
    },

    lab: [
      { kind: 'slider', label: 'Orbits per second', min: 0, max: 1.5, step: 0.01, get: () => rate, set: (v) => {
        pacing = false
        ctx.cancel('orbits')
        rate = v
      }, format: (v) => v.toFixed(2) },
      { kind: 'toggle', label: 'Show the copy', get: () => twin, set: (v) => {
        setTwin(v, 0.8)
        if (v) {
          showFigures()
          ctx.fade(0.8, needleOpacity, 1, setNeedles)
        }
      } },
      {
        kind: 'choice',
        label: 'Camera',
        options: [
          { value: 'saturn', label: 'Saturn' },
          { value: 'moon', label: 'Ride with the moon' },
        ],
        get: () => (rideMix > 0.5 ? 'moon' : 'saturn'),
        set: (v) => {
          free = true
          if (v === 'moon') {
            rideTo({ distance: twin ? 0.74 : 0.56, elevation: 12, side: -30, pull: 0 }, 1.5)
            toRide(2.5)
          } else toWide(2.5)
        },
      },
      { kind: 'action', label: 'Start over', run: startOver },
      { kind: 'readout', label: 'Days', get: () => (orbits() * HYPERION_PERIOD_DAYS).toFixed(0) },
      { kind: 'readout', label: 'Twins apart', get: () => `${((sim.longAxisAngle(0, 1) * 180) / Math.PI).toFixed(2)}°` },
    ],
    notes: [
      'Hyperion is about 360 by 266 by 205 kilometres, a porous rubble pile with the density of snow. Its orbit is stretched (eccentricity 0.1) and nearly synchronous moons nearby keep it from settling, so Saturn’s tidal pull on its long axis changes from pass to pass. Jack Wisdom, Stanton Peale and François Mignard predicted in 1984 that it should tumble chaotically; Voyager 2 and later Cassini found it doing exactly that.',
      'Here the moon is a rigid body turned by Saturn’s gravity gradient, integrated with fourth-order Runge–Kutta. Its twin starts turned a tenth of a degree about the orbit’s axis. The gap between them grows by a factor of about e every orbit (21 days), so within half a year they share nothing but their orbit.',
      'The rings are made of the same dust as everything else: each particle orbits at its own Kepler speed, at radii drawn from the real profile of the C, B and A rings, the Cassini division and the Encke gap. The planet and the moons are not to scale; the rings, relative to the planet, are.',
    ],
  }
}

export default hyperion
