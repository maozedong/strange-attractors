import { buildBifurcationCloud, type BifurcationCloud } from './cloud'

const SEED = 1
let pending: Promise<BifurcationCloud> | null = null

/**
 * The bifurcation cloud, built once per page load and shared by every <Bifurcation />. Runs in
 * a worker; if workers are unavailable or fail, builds on the main thread instead (one ~0.1–0.4 s
 * stall rather than no diagram).
 */
export function loadBifurcationCloud(): Promise<BifurcationCloud> {
  if (pending) return pending
  pending = new Promise<BifurcationCloud>((resolve) => {
    const onMainThread = () => setTimeout(() => resolve(buildBifurcationCloud(SEED)), 0)
    if (typeof Worker === 'undefined') {
      onMainThread()
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./cloud.worker.ts', import.meta.url), { type: 'module' })
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
    worker.onmessage = (event: MessageEvent<BifurcationCloud>) => {
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
    worker.postMessage(SEED)
  })
  return pending
}

/**
 * Start building the cloud now (e.g. a chapter before the logistic stage) so it is ready
 * by the time <Bifurcation /> mounts. Safe to call any number of times.
 */
export function prebuildBifurcation(): void {
  void loadBifurcationCloud()
}
