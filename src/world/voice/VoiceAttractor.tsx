import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { useStore } from '../../store'
import { audio } from '../../audio/engine'
import { worldTele } from '../telemetry'
import { HeadPoints } from '../../scene/trajectories/HeadPoints'
import { createTrajectoryLineMaterial, setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { POINTS, QUIET_LEVEL, VoiceAnalysis, VoiceCurve } from './analysis'
import { VoiceInput } from './sources'
import { smoothstep, speedColorInto } from './dsp'
import { CURVE_GAIN, HEAD_GAIN, HEAD_WHITEN, LINE_PX, TINT_CLEAN, TINT_ROUGH } from './look'

/**
 * Takens's delay embedding of a live sound: every sample x(t) becomes the point
 * (x(t), x(t − τ), x(t − 2τ)), rotated so the diagonal x = y = z stands along +Y. A steady
 * vowel draws a loop, a rough sound a tangle. τ is `voice.delayMs`; what it listens to is
 * `voice.source` (the narration, the visitor's microphone via requestMic(), or a synthesized
 * vowel). Writes worldTele.voiceLevel and worldTele.voicePitch every frame.
 *
 * Local frame: centred on the origin, +Y up; loops face +Z. Unlit, additive, house palette.
 * Draws nothing until the app's audio is unlocked.
 */

const INK = '#efe8dc'

const RING_RADIUS = 0.15
const RING_PX = 1.25
const RING_SEGMENTS = 96
const RING_LEVEL = 0.25
/** the listening ring breathes between (1 − RING_BREATH) and 1 of its level */
const RING_BREATH = 0.3
const RING_PERIOD = 2.6
/** quiet this long (s) before the ring replaces the curve */
const QUIET_HOLD = 0.5

export interface VoiceAttractorProps {
  /**
   * Scale in world units: the loudest recent sample reaches 0.45 × size along each embedding
   * axis, so the curve stays inside a sphere of radius 0.78 × size. Default 2.4
   */
  size?: number
  /** 0..1 fade for the curve, the ring and the synthesized vowel's volume. Default 1 */
  opacity?: number
}

function createRig() {
  const root = new THREE.Group()

  const material = createTrajectoryLineMaterial(LINE_PX)
  const geometry = new LineGeometry()
  // LineGeometry turns n points into n − 1 segments of interleaved (start xyz, end xyz)
  geometry.setPositions(new Float32Array(POINTS * 3))
  geometry.setColors(new Float32Array(POINTS * 3))
  const start = geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
  const colorStart = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute
  const positionBuffer = start.data.setUsage(THREE.DynamicDrawUsage)
  const colorBuffer = colorStart.data.setUsage(THREE.DynamicDrawUsage)
  geometry.instanceCount = 0
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.visible = false
  root.add(line)

  const head = new HeadPoints(1)
  head.setCount(1)
  head.points.visible = false
  root.add(head.points)

  const ringMaterial = createTrajectoryLineMaterial(RING_PX)
  const ringGeometry = new LineGeometry()
  const circle = new Float32Array((RING_SEGMENTS + 1) * 3)
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2
    circle[i * 3] = Math.cos(a)
    circle[i * 3 + 1] = Math.sin(a)
  }
  ringGeometry.setPositions(circle)
  ringGeometry.setColors(new Float32Array((RING_SEGMENTS + 1) * 3).fill(1))
  const ring = new Line2(ringGeometry, ringMaterial)
  ring.frustumCulled = false
  ring.scale.setScalar(RING_RADIUS)
  ring.visible = false
  root.add(ring)

  return {
    root,
    line,
    material,
    geometry,
    positionBuffer,
    colorBuffer,
    positions: positionBuffer.array as Float32Array,
    colors: colorBuffer.array as Float32Array,
    head,
    ring,
    ringMaterial,
    ringGeometry,
    tint: new THREE.Color(),
    headColor: new THREE.Color(),
    ink: new THREE.Color(INK),
    quat: new THREE.Quaternion(),
    curve: new VoiceCurve(),
    /** 0 = curve shown, 1 = listening ring shown */
    listen: 0,
    clock: 0,
    hide() {
      line.visible = false
      head.points.visible = false
      ring.visible = false
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      head.dispose()
      ringGeometry.dispose()
      ringMaterial.dispose()
    },
  }
}

type Rig = ReturnType<typeof createRig>

export function VoiceAttractor({ size = 2.4, opacity = 1 }: VoiceAttractorProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ size, opacity })
  live.current.size = size
  live.current.opacity = opacity
  const groupRef = useRef<THREE.Group>(null)
  const rigRef = useRef<Rig | null>(null)
  const inputRef = useRef<VoiceInput | null>(null)
  const analysisRef = useRef<VoiceAnalysis | null>(null)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)

  // Created in an effect (not during render) so Fast Refresh remounts get fresh, undisposed
  // objects; the audio graph is built lazily in the frame loop once a context exists.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const rig = createRig()
    group.add(rig.root)
    rigRef.current = rig
    return () => {
      group.remove(rig.root)
      rig.dispose()
      rigRef.current = null
      inputRef.current?.dispose()
      inputRef.current = null
      worldTele.voiceLevel = 0
      worldTele.voicePitch = 0
    }
  }, [])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    rig.material.resolution.set(width, height)
    rig.ringMaterial.resolution.set(width, height)
  }, [width, height])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    setLinePixelRatio(rig.material, dpr)
    setLinePixelRatio(rig.ringMaterial, dpr)
    rig.head.setPixelRatio(dpr)
  }, [dpr])

  useFrame((state, delta) => {
    const rig = rigRef.current
    const group = groupRef.current
    if (!rig || !group) return
    const dt = Math.min(Math.max(delta, 0), 0.1)
    const { size: s, opacity: o } = live.current
    const fade = Math.max(0, Math.min(1, o))

    const ctx = audio.context
    if (!ctx) {
      // not unlocked yet: nothing to listen to, nothing drawn; look again next frame
      rig.hide()
      worldTele.voiceLevel = 0
      worldTele.voicePitch = 0
      return
    }

    let input = inputRef.current
    if (!input || input.ctx !== ctx) {
      input?.dispose()
      input = inputRef.current = new VoiceInput(ctx)
    }
    let a = analysisRef.current
    if (!a || a.sampleRate !== ctx.sampleRate) a = analysisRef.current = new VoiceAnalysis(ctx.sampleRate)

    const { source, delayMs } = useStore.getState().voice
    const connected = input.sync(source)
    if (source === 'tone') input.setToneLevel(fade)
    a.adaptiveFloor = source === 'mic'
    if (connected && ctx.state === 'running') {
      input.analyser.getFloatTimeDomainData(a.win)
      a.ingest(input.serial, ctx.currentTime)
    } else {
      a.idle()
    }
    a.follow(dt)
    worldTele.voiceLevel = a.level
    worldTele.voicePitch = a.pitch

    // quiet for a while: cross-fade to the listening ring (slowly out, quickly back)
    const target = a.quietTime > QUIET_HOLD ? 1 : 0
    const tau = target > rig.listen ? 0.25 : 0.06
    rig.listen += (target - rig.listen) * (1 - Math.exp(-dt / tau))
    rig.clock += dt
    const curveVis = (1 - rig.listen) * smoothstep(0.5 * QUIET_LEVEL, 2.5 * QUIET_LEVEL, a.level) * fade
    const ringVis = rig.listen * fade

    const curve = rig.curve
    if (curveVis > 0.002) curve.update(a, delayMs, s)
    const n = curveVis > 0.002 ? curve.count : 0
    if (n >= 2) {
      writeSegments(rig, curve, n)
      speedColorInto(TINT_CLEAN + (TINT_ROUGH - TINT_CLEAN) * a.roughness, rig.tint)
      rig.material.color.copy(rig.tint).multiplyScalar(CURVE_GAIN * curveVis)
      rig.line.visible = true

      const p = curve.points
      const k = (n - 1) * 3
      rig.head.setPosition(0, p[k], p[k + 1], p[k + 2])
      rig.headColor.copy(rig.tint).lerp(WHITE, HEAD_WHITEN).multiplyScalar(HEAD_GAIN * curveVis * curve.brightness[n - 1])
      rig.head.setColor(0, rig.headColor)
      rig.head.points.visible = true
    } else {
      rig.line.visible = false
      rig.head.points.visible = false
    }

    if (ringVis > 0.002) {
      const breath = 1 - RING_BREATH * (0.5 - 0.5 * Math.cos((2 * Math.PI * rig.clock) / RING_PERIOD))
      rig.ringMaterial.color.copy(rig.ink).multiplyScalar(RING_LEVEL * breath * ringVis)
      // face the camera whatever the parent's rotation
      group.getWorldQuaternion(rig.quat).invert().multiply(state.camera.quaternion)
      rig.ring.quaternion.copy(rig.quat)
      rig.ring.visible = true
    } else {
      rig.ring.visible = false
    }
  })

  return <group ref={groupRef} />
}

const WHITE = new THREE.Color(1, 1, 1)

/** Points, brightness and beam scale → the line's interleaved segment buffers (segment j joins points j and j + 1). */
function writeSegments(rig: Rig, curve: VoiceCurve, n: number): void {
  const p = curve.points
  const b = curve.brightness
  const seg = curve.segment
  const pos = rig.positions
  const col = rig.colors
  const segs = n - 1
  for (let j = 0, i = 0, o = 0; j < segs; j++, i += 3, o += 6) {
    pos[o] = p[i]
    pos[o + 1] = p[i + 1]
    pos[o + 2] = p[i + 2]
    pos[o + 3] = p[i + 3]
    pos[o + 4] = p[i + 4]
    pos[o + 5] = p[i + 5]
    const k = seg[j]
    const b0 = b[j] * k
    const b1 = b[j + 1] * k
    col[o] = b0
    col[o + 1] = b0
    col[o + 2] = b0
    col[o + 3] = b1
    col[o + 4] = b1
    col[o + 5] = b1
  }
  rig.positionBuffer.needsUpdate = true
  rig.colorBuffer.needsUpdate = true
  rig.geometry.instanceCount = segs
}
