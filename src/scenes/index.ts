/**
 * Scene registry. Every scene of the screenplay is a module in this folder (or a folder with an
 * index) whose default export is a SceneFactory; each is loaded when the film reaches it. A
 * scene that is missing or fails to load is replaced by the placeholder.
 */
import type { SceneFactory } from '../film/types'

type Loader = () => Promise<{ default: SceneFactory }>

const files = import.meta.glob<{ default: SceneFactory }>(['./*.ts', './*/index.ts', '!./index.ts', '!./kit/**'])

const known: Record<string, Loader> = {}
for (const [path, load] of Object.entries(files)) {
  const id = path.replace(/^\.\//, '').replace(/\/index\.ts$/, '').replace(/\.ts$/, '')
  known[id] = load
}
known.__placeholder = known.placeholder

/**
 * In development a scene file may have been created after the dev server listed this folder
 * (the list is only refreshed with hot reload on). Ask the server for it by path instead.
 */
function byPath(id: string): Loader {
  const stamp = Date.now()
  return () =>
    import(/* @vite-ignore */ `/src/scenes/${id}.ts?t=${stamp}`).catch(
      () => import(/* @vite-ignore */ `/src/scenes/${id}/index.ts?t=${stamp}`),
    ) as Promise<{ default: SceneFactory }>
}

export const SCENE_LOADERS: Record<string, Loader> = import.meta.env.DEV
  ? new Proxy(known, {
      get(target, id) {
        if (typeof id !== 'string') return undefined
        return target[id] ?? byPath(id)
      },
    })
  : known
