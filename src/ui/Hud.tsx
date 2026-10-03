import { useStore } from '../store'
import { getSystem } from '../systems'
import { useTelemetry } from './useTelemetry'
import { fixed, int, sci } from './format'
import { PRESET_LABELS } from '../fractal/ifs'
import { CAT_PERIOD, getCatStep } from '../fractal/cat'
import { worldTele } from '../world/telemetry'

/** Small live numbers under the brand: what is running, and for how long. */
export function Hud() {
  const t = useTelemetry(8)
  const stage = useStore((s) => s.stage)
  const systemId = useStore((s) => s.systemId)
  const swarmVisible = useStore((s) => s.swarmVisible)
  const r = useStore((s) => s.fractal.r)
  const scale = useStore((s) => s.fractal.mandel.scale)
  const ifs = useStore((s) => s.ifs)
  const coast = useStore((s) => s.coast)
  const bulb = useStore((s) => s.bulb)
  const taffyLamps = useStore((s) => s.taffy.lamps)
  const flockCount = useStore((s) => s.flock.count)
  const leniaSpecies = useStore((s) => s.lenia.species)
  if (stage === 'flock') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Boids</b> 1986
        </span>
        <span>
          <b>{int(flockCount)}</b> birds
        </span>
        <span>
          flying together <b>{Math.round(worldTele.flockAlignment * 100)}%</b>
        </span>
      </div>
    )
  }
  if (stage === 'turing') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Reaction–diffusion</b> 1952
        </span>
        <span>
          steps <b>{int(worldTele.turingSteps)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'lenia') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Lenia</b> 2019
        </span>
        <span>{leniaSpecies}</span>
        <span>
          generation <b>{fixed(worldTele.leniaGeneration, 0)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'fireflies') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Kuramoto</b> 1975
        </span>
        <span>
          in step <b>{Math.round(worldTele.firefliesOrder * 100)}%</b>
        </span>
      </div>
    )
  }
  if (stage === 'sandpile') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Sandpile</b> 1987
        </span>
        <span>
          grains <b>{int(worldTele.sandGrains)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'pendulum') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Double pendulums</b>
        </span>
        <span>
          released <b>{fixed(worldTele.pendulumTime, 1)}</b> s ago
        </span>
      </div>
    )
  }
  if (stage === 'forecast') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Lorenz-96</b> 1996
        </span>
        <span>
          day <b>{fixed(worldTele.forecastDay, 1)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'voice') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Delay embedding</b> 1981
        </span>
        <span>
          level <b>{Math.round(worldTele.voiceLevel * 100)}%</b>
        </span>
      </div>
    )
  }
  if (stage === 'hyperion') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Hyperion</b> 1984
        </span>
        <span>
          day <b>{fixed(worldTele.hyperionDays, 0)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'taffy') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>{taffyLamps ? 'Lava lamps' : 'Taffy puller'}</b>
        </span>
        {!taffyLamps && (
          <span>
            pulls <b>{fixed(worldTele.taffyPulls, 1)}</b>
          </span>
        )}
      </div>
    )
  }
  if (stage === 'ifs') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Chaos game</b> 1988
        </span>
        <span>{PRESET_LABELS[ifs.preset]}</span>
        <span>
          <b>{ifs.rate}</b> rolls per second
        </span>
      </div>
    )
  }
  if (stage === 'coast') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Great Britain</b> Natural Earth
        </span>
        {coast.ruler > 0 && (
          <span>
            ruler <b>{coast.ruler}</b> km
          </span>
        )}
      </div>
    )
  }
  if (stage === 'bulb') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Mandelbulb</b> 2009
        </span>
        <span>
          power <b>{bulb.power.toFixed(1)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'cat') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Arnold's cat</b> 1960s
        </span>
        <span>
          step <b>{getCatStep()}</b> of {CAT_PERIOD}
        </span>
      </div>
    )
  }
  if (stage === 'logistic') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Logistic map</b> 1976
        </span>
        <span>
          r <b>{r.toFixed(3)}</b>
        </span>
      </div>
    )
  }
  if (stage === 'mandelbrot') {
    return (
      <div className="hud" aria-live="off">
        <span>
          <b>Mandelbrot set</b> 1980
        </span>
        <span>
          magnification <b>{sci(1.1 / scale, 1)}</b>
        </span>
      </div>
    )
  }
  const sys = getSystem(systemId)
  return (
    <div className="hud" aria-live="off">
      <span>
        <b>{sys.name}</b> {sys.year}
      </span>
      <span>
        t <b>{fixed(t.simTime, 1)}</b>
      </span>
      {swarmVisible && t.particleCount > 0 && (
        <span>
          <b>{int(t.particleCount)}</b> particles
        </span>
      )}
    </div>
  )
}
