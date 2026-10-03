import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { hyperionLive } from '../world/hyperion'

export interface FilmApi {
  /** advance the whole scene by `dt` seconds and render one frame */
  step: (dt: number) => void
  /** place the camera */
  camera: (pos: [number, number, number], target: [number, number, number], fov?: number) => void
  /** world positions of Hyperion and its twin, for a follow shot */
  hyperion: () => { moon: number[]; twin: number[] }
  time: number
}

const target = new Vector3()

/**
 * Mount once inside the Canvas when FILM is on. Exposes `window.__film`, which a recording
 * script drives one frame at a time: every stage then advances by exactly the requested
 * delta, so motion is smooth however long each screenshot takes.
 */
export function FilmHook() {
  const advance = useThree((s) => s.advance)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const api: FilmApi = {
      time: 0,
      step(dt) {
        api.time += dt
        advance(api.time, true)
      },
      camera(pos, tgt, fov) {
        camera.position.set(pos[0], pos[1], pos[2])
        target.set(tgt[0], tgt[1], tgt[2])
        camera.lookAt(target)
        if (fov !== undefined && 'fov' in camera) {
          ;(camera as unknown as { fov: number }).fov = fov
          ;(camera as unknown as { updateProjectionMatrix: () => void }).updateProjectionMatrix()
        }
      },
      hyperion: () => ({ moon: hyperionLive.moon.toArray(), twin: hyperionLive.twin.toArray() }),
    }
    ;(window as unknown as { __film: FilmApi }).__film = api
  }, [advance, camera])
  return null
}
