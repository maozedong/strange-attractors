import type { AttractorSystem, SystemId } from '../types'
import { aizawa } from './aizawa'
import { arneodo } from './arneodo'
import { burkeShaw } from './burkeShaw'
import { chen } from './chen'
import { chua } from './chua'
import { dadras } from './dadras'
import { fourwing } from './fourwing'
import { halvorsen } from './halvorsen'
import { lorenz } from './lorenz'
import { lorenz84 } from './lorenz84'
import { rossler } from './rossler'
import { sprottB } from './sprottB'
import { thomas } from './thomas'

/** Ordered catalog. The index in this array is the GLSL `uSystem` id. */
export const SYSTEMS: AttractorSystem[] = [
  lorenz,
  rossler,
  thomas,
  aizawa,
  halvorsen,
  chen,
  dadras,
  fourwing,
  sprottB,
  burkeShaw,
  arneodo,
  chua,
  lorenz84,
]

export const SYSTEM_BY_ID: Record<string, AttractorSystem> = Object.fromEntries(
  SYSTEMS.map((s) => [s.id, s]),
)

export function getSystem(id: SystemId): AttractorSystem {
  const s = SYSTEM_BY_ID[id]
  if (!s) throw new Error(`Unknown system ${id}`)
  return s
}

export function systemIndex(id: SystemId): number {
  return SYSTEMS.findIndex((s) => s.id === id)
}

export function defaultParams(s: AttractorSystem): number[] {
  return s.params.map((p) => p.default)
}
