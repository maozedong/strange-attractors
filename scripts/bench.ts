/**
 * How long a frame of the film takes to draw, scene by scene.
 *
 *   pnpm dev --port 5199
 *   pnpm bench                                   # every scene, a laptop's full screen
 *   pnpm bench -- --scenes shape:12,roll:22      # some scenes, at a given second
 *   pnpm bench -- --n 1024 --json out.json --label "a million grains"
 *
 * A headless Chrome opens the film in ?cinema mode on the render driver's clock (scripts/render/
 * inject.js), runs each scene to the chosen second, then times frames one by one. A frame's time
 * is the script that draws it plus the wait for the GPU to finish it: one pixel is read back after
 * each frame, which does not return until everything drawn so far is done. No vsync, no screen:
 * the numbers are the cost of the work, not what a display would show.
 *
 * A laptop GPU slows its clock when it has little to do, and waiting after every frame leaves it
 * idle most of the time, so a light frame reads slower than it is. `--burst 8` draws eight frames
 * back to back and waits once: the time per frame then is what the GPU needs when kept busy.
 *
 * Only one of these runs at a time on a machine (scripts/gpuLock.ts), because two sharing a GPU
 * would time each other.
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCREENPLAY } from '../src/film/screenplay'
import { lockGpu, unlockGpu } from './gpuLock'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

/** a moment in every scene when its subject is on screen */
const DEFAULT_SHOTS = 'rounding:30,twins:20,swarm:10,shape:12,heat:16,zoo:14,tap:16,feigenbaum:18,shadow:18,julia:16,roll:22,coast:18,bulb:16,cat:18,pendulums:16,forecast:18,voice:14,hyperion:16,hold:16,murmuration:14,turing:16,lenia:16,fireflies:16,sandpile:20,return:20'
const SHOTS = arg('scenes', DEFAULT_SHOTS).split(',').map((s) => {
  const [id, t] = s.split(':')
  return { id, t: Number(t ?? 12) }
})
const URL_BASE = arg('url', 'http://localhost:5199/')
const WIDTH = Number(arg('width', '1512'))
const HEIGHT = Number(arg('height', '982'))
const DSF = Number(arg('dsf', '2'))
const DUST = arg('n', '512')
const FRAMES = Number(arg('frames', '90'))
const PORT = Number(arg('port', '9490'))
const EVAL = arg('eval', '')
const QUERY = arg('query', '')
const JSON_OUT = arg('json', '')
const LABEL = arg('label', '')
/** frames drawn back to back before each wait for the GPU; see the header */
const BURST = Number(arg('burst', '1'))
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ───────────── Chrome ─────────────
interface Reply {
  result?: { value?: unknown }
  exceptionDetails?: { text: string; exception?: { description?: string } }
}
let ws: WebSocket
let seq = 0
const waiting = new Map<number, { resolve: (v: Reply) => void; reject: (e: Error) => void }>()
const send = (method: string, params: Record<string, unknown> = {}): Promise<Reply> =>
  new Promise((resolve, reject) => {
    waiting.set(++seq, { resolve, reject })
    ws.send(JSON.stringify({ id: seq, method, params }))
  })
async function run(expression: string): Promise<unknown> {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

/** in the page before anything else: the real clock, and the timing loop */
const PRELUDE = `
window.__realNow = performance.now.bind(performance)
window.__bench = async (dt, frames, burst = 1) => {
  const gl = window.strangeAttractors.engine.renderer.getContext()
  const px = new Uint8Array(4)
  const script = [], total = []
  for (let i = 0; i < frames; i++) {
    const a = window.__realNow()
    let own = 0
    let done
    for (let k = 0; k < burst; k++) {
      if (done) await done
      const t = window.__realNow()
      done = window.__cap.pump(dt)   // the frame is drawn before this returns its promise
      own += window.__realNow() - t
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const c = window.__realNow()
    script.push(own / burst)
    total.push((c - a) / burst)
    await done
  }
  const info = window.strangeAttractors.engine.renderer.info
  return JSON.stringify({ script, total, calls: info.render.calls, triangles: info.render.triangles })
}
`

interface Row {
  scene: string
  t: number
  /** milliseconds per frame: median, and the slow tail */
  ms: number
  p90: number
  /** of which, script (JavaScript and submitting the draw calls) */
  script: number
  calls: number
  triangles: number
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const quantile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))]

async function main() {
  await lockGpu()
  const profile = join(tmpdir(), `strange-attractors-bench-${PORT}`)
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' })
  const quit = () => {
    chrome.kill()
    unlockGpu()
  }
  process.on('exit', quit)
  process.on('SIGINT', () => process.exit(1))
  process.on('SIGTERM', () => process.exit(1))

  let target: { webSocketDebuggerUrl: string } | null = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      if (r.ok) target = (await r.json()) as { webSocketDebuggerUrl: string }
    } catch {
      await sleep(200)
    }
  }
  if (!target) throw new Error('Chrome did not start')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((ok) => ws.addEventListener('open', () => ok()))
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(String(m.data)) as { id?: number; result?: Reply; error?: { message: string }; method?: string; params?: { type?: string; args?: { value?: unknown; description?: string }[] } }
    if (msg.id !== undefined) {
      const w = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) w?.reject(new Error(msg.error.message))
      else w?.resolve(msg.result ?? {})
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.warn('[page]', JSON.stringify(msg.params).slice(0, 500))
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      console.warn('[page error]', (msg.params.args ?? []).map((a) => a.value ?? a.description).join(' ').slice(0, 300))
    }
  })

  const inject = await readFile(new URL('./render/inject.js', import.meta.url), 'utf8')
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DSF, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: inject })

  const ids = SCREENPLAY.map((s) => s.id)
  const dt = 1000 / 60
  const rows: Row[] = []
  console.log(`${WIDTH * DSF}×${HEIGHT * DSF}, ${DUST}² grains${LABEL ? `, ${LABEL}` : ''}`)
  console.log('scene          ms/frame    p90  script   fps')
  for (const shot of SHOTS) {
    const index = ids.indexOf(shot.id)
    if (index < 0) throw new Error(`no scene called ${shot.id}`)
    await send('Page.navigate', { url: `${URL_BASE}?cinema&captions=0&n=${DUST}&dpr=${DSF}${QUERY ? `&${QUERY}` : ''}&v=${Date.now()}` })
    for (let i = 0; ; i++) {
      await sleep(100)
      const ok = await run(`window.__cap ? window.__cap.pump(${dt}).then(() => window.__cap.ready(${JSON.stringify(ids)})) : false`).catch(() => false)
      if (ok) break
      if (i > 600) throw new Error('the film did not load')
    }
    if (EVAL) await run(EVAL)
    await run(`window.__cap.begin(${index})`)
    let left = Math.round(shot.t * 60)
    while (left > 0) {
      const r = JSON.parse(String(await run(`window.__cap.skip(${dt}, 1e9, ${Math.min(left, 600)})`))) as { frames: number; status: string }
      left -= r.frames
      if (r.status === 'ended') break
    }
    if (EVAL) await run(EVAL)
    await run(`window.__bench(${dt}, 12, ${BURST})`)
    const r = JSON.parse(String(await run(`window.__bench(${dt}, ${Math.max(8, Math.round(FRAMES / BURST))}, ${BURST})`))) as { script: number[]; total: number[]; calls: number; triangles: number }
    const row: Row = { scene: shot.id, t: shot.t, ms: median(r.total), p90: quantile(r.total, 0.9), script: median(r.script), calls: r.calls, triangles: r.triangles }
    rows.push(row)
    console.log(`${row.scene.padEnd(13)} ${row.ms.toFixed(2).padStart(8)} ${row.p90.toFixed(2).padStart(6)} ${row.script.toFixed(2).padStart(7)} ${(1000 / row.ms).toFixed(0).padStart(5)}`)
  }
  const mean = rows.reduce((s, r) => s + r.ms, 0) / rows.length
  const worst = rows.reduce((a, b) => (b.ms > a.ms ? b : a))
  console.log(`mean ${mean.toFixed(2)} ms, slowest ${worst.scene} ${worst.ms.toFixed(2)} ms`)
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify({ label: LABEL, width: WIDTH * DSF, height: HEIGHT * DSF, n: Number(DUST), mean, rows }, null, 1))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
