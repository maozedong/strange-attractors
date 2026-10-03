import { IDENTITY_GRAINS, runSandJob, SAND_N, type SandJob, type SandJobResult } from './pile'

/**
 * Module flag for the UI: true once the single-source pattern has been computed (it is then kept
 * for the rest of the page's life). Not telemetry: it changes once.
 */
export const sandpileStatus = { identityReady: false }

/** Run one job in a fresh worker; if workers are unavailable or fail, on the main thread. */
function runJob(job: SandJob): Promise<SandJobResult> {
  return new Promise<SandJobResult>((resolve) => {
    const onMainThread = () => setTimeout(() => resolve(runSandJob(job)), 0)
    if (typeof Worker === 'undefined') {
      onMainThread()
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./sandpile.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      onMainThread()
      return
    }
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      worker.terminate()
      onMainThread()
    }
    worker.onmessage = (event: MessageEvent<SandJobResult>) => {
      if (settled) return
      settled = true
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fail()
    }
    worker.onmessageerror = fail
    worker.postMessage(job)
  })
}

let identity: Promise<Uint8Array> | null = null
let identityGrid: Uint8Array | null = null
let identityMs = 0

/**
 * The single-source pattern: IDENTITY_GRAINS grains on the centre of an empty SAND_N grid, fully
 * relaxed. Computed once per page load, in a worker; shared by every <Sandpile />.
 */
export function loadSandpileIdentity(): Promise<Uint8Array> {
  if (identity) return identity
  identity = runJob({ kind: 'identity', n: SAND_N, grains: IDENTITY_GRAINS }).then((r) => {
    identityGrid = r.grid
    identityMs = r.ms
    sandpileStatus.identityReady = true
    return r.grid
  })
  return identity
}

/** The pattern if it is ready, else null. */
export function getSandpileIdentity(): Uint8Array | null {
  return identityGrid
}

/** Wall time the pattern took to compute (ms), 0 until it is ready. */
export function getSandpileIdentityMs(): number {
  return identityMs
}

const critical = new Map<number, Promise<Uint8Array>>()

/**
 * A critical starting pile for `seed` (see buildCriticalPile), from a worker. The last few are
 * kept, so a remount on the same reset serial starts at once. Treat the grid as read-only.
 */
export function loadCriticalPile(seed: number): Promise<Uint8Array> {
  const hit = critical.get(seed)
  if (hit) return hit
  const pending = runJob({ kind: 'critical', n: SAND_N, seed }).then((r) => r.grid)
  critical.set(seed, pending)
  while (critical.size > 3) critical.delete(critical.keys().next().value as number)
  return pending
}

/**
 * Start computing the single-source pattern now (e.g. from the chapter before), so it is ready
 * when the stage asks. Safe to call any number of times.
 */
export function prebuildSandpile(): void {
  void loadSandpileIdentity()
}
