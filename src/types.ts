/**
 * Shared contracts for the whole app. Every module (systems catalog, GPU swarm,
 * CPU trajectories, UI) programs against these types. Keep this file small and stable.
 */

export type SystemId =
  | 'lorenz'
  | 'rossler'
  | 'thomas'
  | 'aizawa'
  | 'halvorsen'
  | 'chen'
  | 'dadras'
  | 'fourwing'
  | 'sprottB'
  | 'burkeShaw'
  | 'arneodo'
  | 'chua'
  | 'lorenz84'

export type Vec3 = [number, number, number]

export interface ParamDef {
  /** stable key, e.g. 'rho' */
  key: string
  /** human label shown next to the slider, e.g. 'ρ' */
  label: string
  default: number
  min: number
  max: number
  step?: number
}

/**
 * Render transform. A point p in system units is drawn at (p - center) * scale,
 * which should land the attractor inside roughly the unit ball so every system
 * frames the same way on screen.
 */
export interface Frame {
  center: Vec3
  scale: number
}

export interface AttractorSystem {
  id: SystemId
  /** Display name, e.g. 'Lorenz' */
  name: string
  /** Year it was published / discovered */
  year: number
  /** Who found it, e.g. 'Edward Lorenz' */
  credit: string
  /** One short line, under ~60 characters, for the zoo tile */
  tagline: string
  /** Two or three pop-science sentences shown when the system is selected */
  blurb: string
  /** Ordered parameters. Index i maps to GLSL uniform P[i] and to params[i] in JS. Max 8. */
  params: ParamDef[]
  /** Integration step in system time units (RK4) */
  dt: number
  /** Default playback rate: system time units per real second at speed ×1 */
  rate: number
  /**
   * GLSL body of the derivative. Must assign the derivative to `d` (a vec3) given
   * the state `v` (vec3) and params `P[0..7]` (float array). No return statement.
   * Example: 'd = vec3(P[0]*(v.y-v.x), v.x*(P[1]-v.z)-v.y, v.x*v.y-P[2]*v.z);'
   */
  glsl: string
  /** JS derivative, must match `glsl` exactly. Writes dx,dy,dz into out[0..2]. */
  f: (out: Float64Array, x: number, y: number, z: number, P: number[]) => void
  /** Render transform for the given params */
  frame: (P: number[]) => Frame
  /** A point ON the attractor (after transient) used for respawns and the cloud experiment */
  seed: (P: number[]) => Vec3
  /** Escape radius measured from frame(P).center, in system units; beyond it a particle respawns */
  bound: (P: number[]) => number
  /** Speed (|dp/dt|) that maps to the hottest colour; roughly the 95th percentile on the attractor */
  speedNorm: (P: number[]) => number
  /** Optional equilibrium points to mark in the scene */
  fixedPoints?: (P: number[]) => Vec3[]
}

/** Commands the UI pushes to the GPU swarm; the Swarm component drains them each frame. */
export type SwarmCommand =
  | { type: 'spawnCloud'; center: Vec3; radius: number }
  | { type: 'spawnAttractor' }
  | { type: 'switchSystem'; from: Frame; to: Frame }

/** Commands for the CPU-integrated trajectory lines. */
export type TrajCommand =
  | {
      type: 'start'
      /** number of trajectories, 1 or 2 */
      count: 1 | 2
      origin: Vec3
      /** separation of the second trajectory from the first, in system units */
      nudge: number
      /** points of history kept per trajectory */
      history: number
      /** fade the tail to transparent */
      fade: boolean
    }
  | { type: 'clear' }
