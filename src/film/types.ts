import type * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import type { Dust } from '../engine/Dust'
import type { CameraRig } from '../engine/CameraRig'
import type { Label, LabelOptions } from '../engine/Labels'
import type { Palette } from '../engine/palettes'

/**
 * What a scene is given. Everything made through the context (tweens, timers, labels, objects
 * added to `root`) belongs to the scene and is cleaned up when it leaves.
 */
export interface SceneContext {
  readonly engine: Engine
  readonly dust: Dust
  readonly rig: CameraRig
  readonly renderer: THREE.WebGLRenderer
  /** the dust is size × size particles */
  readonly size: number
  /** the act's colours */
  readonly palette: Palette
  /** this scene's own group in the scene graph */
  readonly root: THREE.Group
  /** seconds since this scene's narration began (holds still in the lab) */
  readonly time: number
  /** the frame is taller than wide */
  readonly portrait: boolean
  /** the scene is being explored by hand: narration and cues are stopped */
  readonly lab: boolean

  /** run `apply(u)` with u from 0 to 1 over `seconds` of film time; a new tween with the same tag replaces the old */
  tween(seconds: number, apply: (u: number) => void, opts?: { ease?: (t: number) => number; tag?: string; done?: () => void }): void
  cancel(tag: string): void
  /** call `fn` after `seconds` of film time */
  after(seconds: number, fn: () => void): void
  label(text: string, opts: LabelOptions): Label
  /** seconds until a line (optionally a phrase inside it) is spoken; Infinity if it has passed */
  until(line: number, word?: string): number
  /** pointer on the stage: x, y in −1..1 (y up), plus drag deltas in CSS pixels */
  onPointer(fn: (e: StagePointer) => void): void
  /** fade this scene's whole group: 0..1 passed to `apply` over `seconds`, for props */
  fade(seconds: number, from: number, to: number, apply: (v: number) => void): void
}

export interface StagePointer {
  type: 'down' | 'move' | 'up'
  x: number
  y: number
  dx: number
  dy: number
  /** a button or finger is down */
  pressed: boolean
  /** set true to keep the camera from orbiting during this drag */
  claim(): void
}

/** When something happens, in the scene's own words. */
export interface Cue {
  /** index of the spoken line (gates not counted) */
  line?: number
  /** a phrase inside that line; the cue fires when it is spoken */
  word?: string
  /** 'start' = first word of the scene, 'end' = after the last word */
  when?: 'start' | 'end'
  /** seconds added (negative = earlier) */
  offset?: number
  run: () => void
}

/** `at(3, fn)`, `at(3, 'fan opens', fn)`, `at(3, -9.4, fn)`, `at('start', fn)`, `at('end', 1.5, fn)` */
export function at(line: number | 'start' | 'end', a: string | number | (() => void), b?: number | (() => void), c?: () => void): Cue {
  const cue: Cue = { run: () => undefined }
  if (typeof line === 'number') cue.line = line
  else cue.when = line
  for (const arg of [a, b, c]) {
    if (typeof arg === 'string') cue.word = arg
    else if (typeof arg === 'number') cue.offset = arg
    else if (typeof arg === 'function') cue.run = arg
  }
  return cue
}

export type LabControl =
  | { kind: 'slider'; label: string; min: number; max: number; step?: number; get: () => number; set: (v: number) => void; format?: (v: number) => string }
  | { kind: 'choice'; label: string; options: { value: string; label: string }[]; get: () => string; set: (v: string) => void }
  | { kind: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void }
  | { kind: 'action'; label: string; run: () => void }
  | { kind: 'readout'; label: string; get: () => string }

export interface Scene {
  /** build and show the opening picture; `from` is the scene being left, if any */
  enter(from: string | null): void
  cues?: Cue[]
  /** what each gate does when it opens (by the visitor or by its timeout) */
  gates?: Record<string, () => void>
  /** every frame; `t` is the scene clock */
  update?(dt: number, t: number): void
  /** begin leaving: fade props out. The dust is taken over by the next scene. */
  exit?(): void
  /** free GPU resources; called once the scene is off screen */
  dispose(): void
  /** dials for the lab drawer */
  lab?: LabControl[]
  /** a few paragraphs of depth for the lab drawer */
  notes?: string[]
}

export type SceneFactory = (ctx: SceneContext) => Scene

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeIn = (t: number) => t * t * t
export const linear = (t: number) => t
