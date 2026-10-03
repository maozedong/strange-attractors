import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { setLinePixelRatio } from '../../scene/trajectories/lineMaterial'
import { worldTele } from '../telemetry'
import { advance, autoDeck, createRig, createSim, noRaycast } from './stage'

export { PENDULUM_BOUNDS, PENDULUM_LENGTH } from './physics'

/**
 * A hundred double pendulums released together, copy k of N nudged by
 * nudge·(2k/(N−1) − 1) radians on the inner arm. They swing as one bright pendulum (the
 * identical rods add up), then the fan opens into a spectrum.
 *
 * Driven by `pendulum` in the store, read every frame: a `resetSerial` change rebuilds all
 * copies at the release angle with the current count and nudge; `running` integrates (fixed
 * RK4 step, see ./physics) or freezes. Count and nudge changes are also picked up immediately
 * while the copies are still at the release (time 0). Writes `worldTele.pendulumTime` and
 * `worldTele.pendulumSpread` every frame.
 *
 * Local frame: the pivot is at the origin, the arms hang toward −Y in the XY plane, the tips
 * reach PENDULUM_BOUNDS. Unlit, additive, depthTest off.
 */

export interface DoublePendulumsProps {
  /** 0..1 fade for the whole stage. Default 1 */
  opacity?: number
  /**
   * z spacing between neighbouring copies, render units: copy k sits at z = (k − N/2)·deck, a
   * deck of cards seen from the side. A number fixes it. 'auto' (default) opens the deck to
   * DECK_SPACING as the camera turns side-on and closes it face-on: seen face-on under
   * perspective, any depth spread fans the coincident copies apart on screen (a fixed 0.0015
   * smears a hundred of them over ~10–20 px at the chapter's front pose, so they would never
   * look like one pendulum).
   */
  deck?: number | 'auto'
}

export function DoublePendulums({ opacity = 1, deck = 'auto' }: DoublePendulumsProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ opacity, deck })
  live.current.opacity = opacity
  live.current.deck = deck
  const group = useRef<THREE.Group>(null)
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const [sim] = useState(createSim)

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const deckProp = live.current.deck
    let d = 0
    if (deckProp === 'auto') {
      state.camera.getWorldDirection(_forward)
      d = autoDeck(_forward, _axis.setFromMatrixColumn(g.matrixWorld, 2).normalize())
    } else if (Number.isFinite(deckProp)) d = deckProp
    advance(sim, rig, useStore.getState().pendulum, delta, d)

    worldTele.pendulumTime = sim.ens.time
    worldTele.pendulumSpread = sim.spread

    const fade = Math.max(0, Math.min(1, live.current.opacity))
    const w = state.size.width
    const h = state.size.height
    const dpr = state.gl.getPixelRatio()
    for (let i = 0; i < rig.lineMaterials.length; i++) {
      const m = rig.lineMaterials[i]
      m.resolution.set(w, h)
      setLinePixelRatio(m, dpr)
      m.opacity = fade
    }
    rig.bobMaterial.uniforms.uDpr.value = dpr
    rig.bobMaterial.uniforms.uOpacity.value = fade
    g.visible = fade > 0.001
  })

  return (
    <group ref={group}>
      <primitive object={rig.trails.line} />
      <primitive object={rig.rods.line} />
      <primitive object={rig.ring.line} />
      <points
        geometry={rig.bobGeometry}
        material={rig.bobMaterial}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={3}
      />
    </group>
  )
}

const _forward = new THREE.Vector3()
const _axis = new THREE.Vector3()
