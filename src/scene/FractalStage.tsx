import { useStore } from '../store'
import { CHAPTERS } from '../content/chapters'
import { Bifurcation, DripTap } from '../fractal/logistic'
import { FLESH_LAYOUT, LOGISTIC_LAYOUT, SHADOW_LAYOUT, WORLD_LAYOUT } from './layouts'
import { DoublePendulums } from '../world/pendulum/DoublePendulums'
import { Ensemble } from '../world/forecast'
import { VoiceAttractor } from '../world/voice'
import { HyperionStage } from '../world/hyperion'
import { TaffyPuller, LavaWall } from '../world/taffy'
import { Suspense, lazy } from 'react'

const EmergenceStage = lazy(() => import('./EmergenceStage'))
const EMERGENCE: ReadonlySet<string> = new Set(['flock', 'turing', 'lenia', 'fireflies', 'sandpile'])
import { MandelbrotPlane } from '../fractal/mandel/MandelbrotPlane'
import { JuliaPlane } from '../fractal/mandel/JuliaPlane'
import { ChaosGame } from '../fractal/ifs'
import { Coastline } from '../fractal/coast'
import { Mandelbulb } from '../fractal/bulb'
import { ArnoldCat } from '../fractal/cat'

/** the taffy chapter has two sets: the puller and the lava-lamp wall */
function TaffyStage() {
  const lamps = useStore((s) => s.taffy.lamps)
  return lamps ? <LavaWall width={WORLD_LAYOUT.lampsW} height={WORLD_LAYOUT.lampsH} /> : <TaffyPuller />
}

/** The non-swarm stages: the logistic map with its tap, and the complex plane. */
export function FractalStage() {
  const stage = useStore((s) => s.stage)
  const chapter = useStore((s) => s.chapter)
  const id = CHAPTERS[chapter]?.id
  if (stage === 'logistic') {
    return (
      <group>
        <group position={LOGISTIC_LAYOUT.tap}>
          <DripTap playing opacity={1} />
        </group>
        <group position={LOGISTIC_LAYOUT.diagram}>
          <Bifurcation width={LOGISTIC_LAYOUT.diagramW} height={LOGISTIC_LAYOUT.diagramH} showDoublings={id === 'feigenbaum'} />
        </group>
      </group>
    )
  }
  if (stage === 'pendulum') return <DoublePendulums />
  if (stage === 'forecast') return <Ensemble />
  if (stage === 'voice') return <VoiceAttractor />
  if (stage === 'hyperion') return <HyperionStage />
  if (stage === 'taffy') return <TaffyStage />
  if (EMERGENCE.has(stage)) {
    return (
      <Suspense fallback={null}>
        <EmergenceStage />
      </Suspense>
    )
  }
  if (stage === 'ifs') return <ChaosGame width={FLESH_LAYOUT.ifsSize} height={FLESH_LAYOUT.ifsSize} />
  if (stage === 'coast') return <Coastline width={FLESH_LAYOUT.coastW} height={FLESH_LAYOUT.coastH} />
  if (stage === 'bulb') return <Mandelbulb />
  if (stage === 'cat') return <ArnoldCat width={FLESH_LAYOUT.catSize} height={FLESH_LAYOUT.catSize} />
  if (stage === 'mandelbrot') {
    if (id === 'julia') {
      const w = SHADOW_LAYOUT.juliaPlaneW
      return (
        <group>
          <group position={[-(w / 2 + 0.08), 0, 0]}>
            <MandelbrotPlane width={w} height={w} />
          </group>
          <group position={[w / 2 + 0.08, 0, 0]}>
            <JuliaPlane width={w} height={w} />
          </group>
        </group>
      )
    }
    return (
      <group>
        <group rotation-x={-Math.PI / 2}>
          <MandelbrotPlane width={SHADOW_LAYOUT.planeW} height={SHADOW_LAYOUT.planeH} />
        </group>
        <group position={SHADOW_LAYOUT.diagram}>
          <Bifurcation coord="c" width={SHADOW_LAYOUT.diagramW} height={SHADOW_LAYOUT.diagramH} />
        </group>
      </group>
    )
  }
  return null
}
