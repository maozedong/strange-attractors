import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { getSandpileIdentity, loadCriticalPile, loadSandpileIdentity } from './loader'
import { SAND_N } from './pile'
import { sandFrag, sandVert } from './shaders'
import { createSim, FLASH_SECONDS, holdForReset, loadPile, MAX_DT, seedFor, stepSim, writeGridTexture, writeTexture } from './sim'

/** live ⇄ single-source pattern cross-fade */
const CROSSFADE_SECONDS = 0.6

const noRaycast = () => {}

export interface SandpileProps {
  /** Edge of the square plane in render units, centred on the group origin in the XY plane
   *  facing +Z, row 0 at the bottom. Default 3 */
  size?: number
  /** 0..1 fade for the whole stage. Default 1 */
  opacity?: number
  /** Seconds a toppled site's flash takes to fade. Default 0.4. At 0.4 s about 15% of the grid is
   *  lit at 20 grains/s, 70% at 200, nearly all of it at 2000 (see verify.ts) */
  flash?: number
}

function dataTexture(name: string, data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, SAND_N, SAND_N, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.name = name
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.flipY = false // row 0 is the bottom row already
  t.needsUpdate = true
  return t
}

function createRig() {
  const liveData = new Uint8Array(SAND_N * SAND_N * 4)
  for (let k = 3; k < liveData.length; k += 4) liveData[k] = 255
  const live = dataTexture('Sandpile.live', liveData)
  const patternData = new Uint8Array(SAND_N * SAND_N * 4)
  const pattern = dataTexture('Sandpile.pattern', patternData)
  const uniforms = {
    uLive: { value: live },
    uPattern: { value: pattern },
    uMix: { value: 0 },
    uOpacity: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    name: 'Sandpile.display',
    vertexShader: sandVert,
    fragmentShader: sandFrag,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true, // for the opacity fade; at 1 it draws as a solid plane (depth is written)
  })
  return {
    liveData,
    live,
    patternData,
    pattern,
    material,
    uniforms,
    /** the pattern texture holds the single-source grid */
    patternReady: false,
    /** cross-fade position 0 (live) .. 1 (pattern), linear in time */
    mix: 0,
    /** the live data changed while hidden behind the pattern; upload once it shows again */
    stale: false,
    dispose() {
      live.dispose()
      pattern.dispose()
      material.dispose()
    },
  }
}

/** Requests for fresh piles and their arrival; outlives frames, not the mount. */
function createInbox() {
  return {
    /** reset serial whose pile has been asked for */
    wanted: NaN,
    arrived: null as { serial: number; grid: Uint8Array } | null,
    alive: true,
  }
}
type Inbox = ReturnType<typeof createInbox>

function request(inbox: Inbox, serial: number): void {
  if (inbox.wanted === serial) return
  inbox.wanted = serial
  loadCriticalPile(seedFor(serial)).then(
    (grid) => {
      if (inbox.alive && inbox.wanted === serial) inbox.arrived = { serial, grid }
    },
    (err: unknown) => console.warn('[Sandpile] could not build a pile', err),
  )
}

/**
 * The Bak–Tang–Wiesenfeld sandpile, live: a 255 x 255 grid, 0–3 grains per site; a site that
 * reaches 4 topples, one grain to each neighbour, and grains that fall over the edge are lost.
 *
 * Follows `sandpile` in the store every frame without re-rendering: `running` and `rate`
 * (grains per real second, at most 5000 a frame) drop grains on random sites ('random') or the
 * centre ('centre'), each relaxed completely before the next; every grain is counted into
 * `worldTele.sand*`. Each `resetSerial` starts a fresh, already critical pile (built in a
 * worker, ~40 ms; until the first arrives the stage is hidden) and clears the histogram.
 * Toppled sites flash warm white and fade over `flash` seconds (0.4). An avalanche too big for
 * one frame's toppling budget runs on over the next frames, its front visibly spreading.
 *
 * `identity` cross-fades (0.6 s) to the single-source pattern (100,000 grains poured on the
 * centre of an empty grid), computed once per page in a worker started on mount;
 * `sandpileStatus.identityReady` says when it is there. Until then the live pile stays up.
 *
 * Local frame: the plane is `size` square in XY facing +Z, unlit, NearestFilter.
 */
export function Sandpile({ size = 3, opacity = 1, flash = FLASH_SECONDS }: SandpileProps) {
  // latest props for the frame loop, which must not restart when they change
  const live = useRef({ opacity, flash })
  live.current.opacity = opacity
  live.current.flash = flash
  const group = useRef<THREE.Group>(null)
  const rig = useMemo(createRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  const geometry = useMemo(() => new THREE.PlaneGeometry(size, size), [size])
  useEffect(() => () => geometry.dispose(), [geometry])
  const [sim] = useState(() => createSim(SAND_N))
  const [inbox] = useState(createInbox)

  useEffect(() => {
    inbox.alive = true
    void loadSandpileIdentity()
    request(inbox, useStore.getState().sandpile.resetSerial)
    return () => {
      inbox.alive = false
      inbox.wanted = NaN // a remount asks again (served from the loader's cache)
    }
  }, [inbox])

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const sp = useStore.getState().sandpile

    // a fresh pile per reset serial; the old one stands still (no flashes) until it lands
    if (sp.resetSerial !== inbox.wanted) {
      if (sim.serial >= 0) holdForReset(sim)
      request(inbox, sp.resetSerial)
    }
    const arrived = inbox.arrived
    if (arrived !== null) {
      inbox.arrived = null
      if (arrived.serial === inbox.wanted) loadPile(sim, arrived.grid, arrived.serial)
    }

    sim.flashSeconds = live.current.flash > 0 ? live.current.flash : FLASH_SECONDS
    stepSim(sim, sp, delta)

    if (!rig.patternReady) {
      const grid = getSandpileIdentity()
      if (grid) {
        writeGridTexture(grid, rig.patternData)
        rig.pattern.needsUpdate = true
        rig.patternReady = true
      }
    }
    const target = sp.identity && rig.patternReady ? 1 : 0
    const step = (delta > 0 ? Math.min(delta, MAX_DT) : 0) / CROSSFADE_SECONDS
    rig.mix = target > rig.mix ? Math.min(target, rig.mix + step) : Math.max(target, rig.mix - step)
    const m = rig.mix * rig.mix * (3 - 2 * rig.mix)

    // the live grid is written (and its flashes fade) every frame something changed, but only
    // uploaded while some of it is on screen
    if (writeTexture(sim, rig.liveData, delta)) rig.stale = true
    if (rig.stale && m < 1) {
      rig.live.needsUpdate = true
      rig.stale = false
    }

    const fade = Math.max(0, Math.min(1, live.current.opacity))
    rig.uniforms.uMix.value = m
    rig.uniforms.uOpacity.value = fade
    g.visible = fade > 0.001 && sim.serial >= 0
  })

  return (
    <group ref={group} visible={false}>
      <mesh geometry={geometry} material={rig.material} raycast={noRaycast} />
    </group>
  )
}
