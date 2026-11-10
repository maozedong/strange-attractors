/**
 * Scene registry. Every scene of the screenplay is a module in this folder (or a folder with an
 * index) whose default export is a SceneFactory; each is loaded when the film reaches it. A
 * scene that is missing or fails to load is replaced by the placeholder.
 */
import type { SceneFactory } from '../film/types'

type Loader = () => Promise<{ default: SceneFactory }>

const files = import.meta.glob<{ default: SceneFactory }>(['./*.ts', './*/index.ts', '!./index.ts', '!./kit/**'])

export const SCENE_LOADERS: Record<string, Loader> = {}
for (const [path, load] of Object.entries(files)) {
  const id = path.replace(/^\.\//, '').replace(/\/index\.ts$/, '').replace(/\.ts$/, '')
  SCENE_LOADERS[id] = load
}
SCENE_LOADERS.__placeholder = SCENE_LOADERS.placeholder
