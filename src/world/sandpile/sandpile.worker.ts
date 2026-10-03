/// <reference lib="webworker" />
/**
 * Builds sandpile grids off the main thread and hands each back without copying: the critical
 * starting pile (~40 ms) and the single-source pattern (~1 s on a desktop, several times that on
 * a phone).
 */
import { runSandJob, type SandJob, type SandJobResult } from './pile'

interface Scope {
  onmessage: ((event: MessageEvent<SandJob>) => void) | null
  postMessage(message: SandJobResult, transfer: Transferable[]): void
}
const scope = self as unknown as Scope

scope.onmessage = (event) => {
  const result = runSandJob(event.data)
  scope.postMessage(result, [result.grid.buffer])
}
