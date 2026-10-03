import { Suspense, lazy, type ComponentType } from 'react'
import { useStore } from '../store'

/**
 * Wing V's stages, each in its own chunk, loaded the first time it is shown. The glob lists
 * whichever stage modules exist, so a stage that is missing or fails to load leaves the
 * others working (it simply renders nothing).
 */
const modules = import.meta.glob('../world/{flock,turing,lenia,fireflies,sandpile}/index.ts')

function stage<P extends object>(name: string, pick: (m: Record<string, unknown>) => ComponentType<P> | undefined) {
  const importer = modules[`../world/${name}/index.ts`]
  const Empty: ComponentType<P> = () => null
  return lazy(async () => {
    if (!importer) return { default: Empty }
    try {
      const m = (await importer()) as Record<string, unknown>
      return { default: pick(m) ?? Empty }
    } catch (e) {
      console.error(`[stage] ${name} failed to load`, e)
      return { default: Empty }
    }
  })
}

const Murmuration = stage('flock', (m) => m.Murmuration as ComponentType<object>)
const TuringSphere = stage<{ speed?: number }>('turing', (m) => m.TuringSphere as ComponentType<{ speed?: number }>)
const Lenia = stage('lenia', (m) => m.Lenia as ComponentType<object>)
const Fireflies = stage('fireflies', (m) => m.Fireflies as ComponentType<object>)
const Sandpile = stage<{ flash?: number }>('sandpile', (m) => m.Sandpile as ComponentType<{ flash?: number }>)

export default function EmergenceStage() {
  const st = useStore((s) => s.stage)
  let el = null
  if (st === 'flock') el = <Murmuration />
  // 20 substeps a frame: the dial transitions take 3–15 s of model time and the narration is brisk
  else if (st === 'turing') el = <TuringSphere speed={20} />
  else if (st === 'lenia') el = <Lenia />
  else if (st === 'fireflies') el = <Fireflies />
  else if (st === 'sandpile') el = <Sandpile flash={0.15} />
  return <Suspense fallback={null}>{el}</Suspense>
}
