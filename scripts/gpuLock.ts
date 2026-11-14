/**
 * One GPU job at a time on this machine. The benchmark and the stills tool both take this lock:
 * two headless browsers sharing a GPU would time, and slow, each other.
 */
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOCK = join(tmpdir(), 'strange-attractors-gpu.lock')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function lockGpu(): Promise<void> {
  for (;;) {
    try {
      mkdirSync(LOCK)
      return
    } catch {
      // a lock left by a run that died is taken over after ten minutes
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 600_000) rmSync(LOCK, { recursive: true, force: true })
      } catch {
        /* gone already */
      }
      await sleep(1000)
    }
  }
}

export function unlockGpu(): void {
  rmSync(LOCK, { recursive: true, force: true })
}
