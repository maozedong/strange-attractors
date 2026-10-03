import { useEffect, useRef, type ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PerspectiveCamera, Vector3 } from 'three'
import { useStore } from '../store'
import { CHAPTERS } from '../content/chapters'
import { cameraDirector } from './cameraDirector'
import { FILM } from '../film/flag'

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** width of the narrative panel (keep in sync with --panel-w in styles.css) */
const PANEL_W = 480
/** below this viewport width the panel sits full-width at the bottom instead */
const NARROW = 760

const tmp = new Vector3()
const goal = new Vector3()

/**
 * Orbit controls plus three gentle, interruptible eases: the camera distance toward the
 * chapter's framing, scripted poses from the camera director, and a projection offset that
 * keeps the subject centred in the part of the screen the text panel does not cover.
 * A drag by the visitor cancels any scripted move.
 */
export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const dragging = useRef(false)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const chapter = useStore((s) => s.chapter)
  const freePlay = useStore((s) => s.freePlay)
  const target = useRef(CHAPTERS[0].distance)
  const offset = useRef({ x: 0, y: 0 })
  const poseSerial = useRef(-1)
  const posing = useRef(false)
  const followFrom = useRef({ pos: new Vector3(), target: new Vector3(), start: 0 })

  useEffect(() => {
    target.current = CHAPTERS[chapter]?.distance ?? 3
  }, [chapter])

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __cam: unknown }).__cam = { camera, controls }
  }, [camera])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || FILM) return // a recording script drives the camera directly
    const spec = CHAPTERS[chapter]
    const pose = cameraDirector.pose
    if (cameraDirector.serial !== poseSerial.current) {
      poseSerial.current = cameraDirector.serial
      posing.current = pose !== null
      // follow mode blends from wherever the camera is now toward exact tracking
      followFrom.current.pos.copy(camera.position)
      followFrom.current.target.copy(c.target)
      followFrom.current.start = performance.now()
    }
    c.autoRotateSpeed = reduceMotion || posing.current || cameraDirector.follow ? 0 : (spec?.autoRotate ?? 1) * (freePlay ? 0.5 : 1)

    // poses are composed for landscape; on a narrow screen pull back so the same width fits
    const aspect = size.width / Math.max(1, size.height)
    const back = aspect < 1.5 ? Math.min(3.6, 1.5 / aspect) : 1

    if (!dragging.current) {
      const follow = cameraDirector.follow
      if (follow) {
        follow(goal, tmp)
        // portrait screens: pull back along the line of sight so the same width fits
        tmp.sub(goal).multiplyScalar(back).add(goal)
        const f = followFrom.current
        const u = Math.min(1, (performance.now() - f.start) / (Math.max(0.1, cameraDirector.seconds) * 1000))
        const e = u * u * (3 - 2 * u)
        camera.position.copy(f.pos).lerp(tmp, e)
        c.target.copy(f.target).lerp(goal, e)
      } else if (posing.current && pose) {
        const k = 1 - Math.exp((-dt * 3) / Math.max(0.3, cameraDirector.seconds))
        goal.set(pose.target[0], pose.target[1], pose.target[2])
        tmp.set(pose.position[0], pose.position[1], pose.position[2]).sub(goal).multiplyScalar(back).add(goal)
        camera.position.lerp(tmp, k)
        c.target.lerp(goal, k)
        if (camera.position.distanceTo(tmp) < 1e-3) posing.current = false
      } else if (!pose) {
        // default framing: orbit the origin at the chapter's distance
        const d = camera.position.length()
        const nd = d + (target.current * back - d) * (1 - Math.exp(-dt * 1.6))
        if (Math.abs(nd - d) > 1e-4) camera.position.setLength(nd)
        c.target.lerp(tmp.set(0, 0, 0), 1 - Math.exp(-dt * 2))
      }
    }

    // keep the subject centred in the uncovered part of the viewport
    const textShown = chapter > 0 || freePlay
    const wantX = textShown && size.width > NARROW ? -Math.min(PANEL_W, size.width * 0.4) * 0.5 : 0
    // phones: the sheet covers the lower 46% of the screen, so centre the subject in the rest
    const wantY = textShown && size.width <= NARROW ? size.height * 0.23 : 0
    const k = 1 - Math.exp(-dt * 3)
    const o = offset.current
    o.x += (wantX - o.x) * k
    o.y += (wantY - o.y) * k
    if (Math.abs(o.x) < 0.5 && Math.abs(o.y) < 0.5) {
      if (camera.view?.enabled) camera.clearViewOffset()
    } else {
      camera.setViewOffset(size.width, size.height, o.x, o.y, size.width, size.height)
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!FILM}
      enablePan={false}
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.6}
      zoomSpeed={0.6}
      minDistance={0.4}
      maxDistance={14}
      autoRotate={!reduceMotion}
      onStart={() => {
        dragging.current = true
        posing.current = false
        cameraDirector.release()
      }}
      onEnd={() => {
        dragging.current = false
        target.current = camera.position.length()
      }}
    />
  )
}
