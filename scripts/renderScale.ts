/**
 * How the render scale controller (src/engine/renderScale.ts) behaves, without a browser.
 *
 *   pnpm tsx scripts/renderScale.ts
 *
 * A pretend GPU draws each frame in `fixed + perScale2 × scale²` milliseconds (the pixel count
 * goes with the square of the scale), with some noise and the occasional hitch, and a screen shows
 * it at the next vsync. The costs are the film's own, measured at a laptop's full screen at scales
 * 2 and 1. Each run prints where the scale went and when, and how many frames came late.
 */
import { RenderScale } from '../src/engine/renderScale.ts'

interface Phase {
  name: string
  seconds: number
  /** frame cost in ms at scale 1 and scale 2 */
  at1: number
  at2: number
}

/** frame costs at 3024×1964 (scale 2) and 1512×982 (scale 1) */
const SCENES: Record<string, [number, number]> = {
  hyperion: [7.8, 11.6],
  shape: [10.4, 18.8],
  swarm: [29.1, 69.5],
  roll: [7.0, 11.9],
}

function run(title: string, hz: number, slower: number, phases: Phase[], seed = 1) {
  let r = seed
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648)
  const vsync = 1000 / hz
  const area = 1512 * 982
  const ctl = new RenderScale({ max: 2, min: 1, maxPixels: 6.0e6 }, area)
  console.log(`\n${title}  (${hz} Hz screen, GPU ${slower}× the M1 Pro's time)`)
  let t = 0
  for (const p of phases) {
    const b = ((p.at2 - p.at1) / 3) * slower
    const a = p.at1 * slower - b
    let late = 0
    let frames = 0
    let shown = 0
    const changes: string[] = []
    const startScale = ctl.scale
    for (let left = p.seconds * 1000; left > 0; ) {
      let cost = a + b * ctl.scale * ctl.scale
      cost *= 0.92 + 0.16 * rand()
      if (rand() < 0.004) cost += 40 + 80 * rand()
      // double-buffered vsync: the frame shows at the first vsync after it is done
      const ms = Math.max(1, Math.ceil(cost / vsync)) * vsync
      left -= ms
      t += ms
      frames++
      shown += ctl.scale
      if (ms > (1000 / 60) * 1.4) late++
      const next = ctl.frame(ms)
      if (next !== null) changes.push(`${(t / 1000).toFixed(1)}s→${next}`)
    }
    console.log(
      `  ${p.name.padEnd(9)} ${String(p.seconds).padStart(3)} s  scale ${startScale.toFixed(3)}→${ctl.scale.toFixed(3)} (mean ${(shown / frames).toFixed(2)})  ` +
        `late ${((100 * late) / frames).toFixed(1).padStart(4)}%  changes: ${changes.join(' ') || 'none'}`,
    )
  }
}

const film = (seconds: number[]): Phase[] =>
  ['hyperion', 'shape', 'swarm', 'roll', 'shape'].map((name, i) => ({ name, seconds: seconds[i], at1: SCENES[name][0], at2: SCENES[name][1] }))

run('this laptop', 60, 1, film([20, 40, 20, 40, 60]))
run('this laptop', 120, 1, film([20, 40, 20, 40, 60]))
run('a GPU half as fast', 60, 2, film([20, 40, 20, 40, 60]))
// a scene whose cost sits right on the edge at one step: the case that makes a controller hunt
run('on the edge', 60, 1, [{ name: 'edge', seconds: 300, at1: 9.5, at2: 21.4 }])
