/// <reference lib="webworker" />
/**
 * Builds the bifurcation cloud off the main thread (about 0.1 s on a desktop, several times
 * that on a phone) and hands the buffer back without copying.
 */
import { buildBifurcationCloud } from './cloud'

interface Scope {
  onmessage: ((event: MessageEvent<number>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}
const scope = self as unknown as Scope

scope.onmessage = (event) => {
  const cloud = buildBifurcationCloud(event.data)
  scope.postMessage(cloud, [cloud.positions.buffer])
}
