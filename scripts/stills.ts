/**
 * Stills of chosen moments of the film, for judging a change to how it looks.
 *
 *   pnpm dev --port 5199
 *   pnpm stills -- --out /tmp/before --shots shape:12,roll:22
 *   pnpm stills -- --out /tmp/after --shots shape:12,roll:22 --compare /tmp/before
 *
 * Each shot starts the film cold at that scene (?cinema, the render driver's clock), runs unwatched
 * to the given seconds and keeps one PNG per time: <out>/<scene>-<seconds>.png. The film is
 * deterministic on that clock, so two runs of the same code give the same pixels, and --compare
 * prints how far each still is from the one of the same name in another folder (PSNR in dB;
 * `inf` is identical, above 50 nobody can see, below 40 look at it).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SCREENPLAY } from '../src/film/screenplay'
import { lockGpu, unlockGpu } from './gpuLock'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const OUT = resolve(arg('out', 'renders/stills'))
const SHOTS = arg('shots', 'shape:12').split(',').map((s) => {
  const [id, ...ts] = s.split(':')
  return { id, times: ts.length ? ts.map(Number) : [12] }
})
const URL_BASE = arg('url', 'http://localhost:5199/')
const WIDTH = Number(arg('width', '1000'))
const HEIGHT = Number(arg('height', '724'))
const DSF = Number(arg('dsf', '2'))
const DUST = arg('n', '512')
const PORT = Number(arg('port', '9470'))
const QUERY = arg('query', '')
const EVAL = arg('eval', '')
const COMPARE = arg('compare', '')
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Reply {
  result?: { value?: unknown }
  data?: string
  exceptionDetails?: { text: string; exception?: { description?: string } }
}
let ws: WebSocket
let seq = 0
const waiting = new Map<number, { resolve: (v: Reply) => void; reject: (e: Error) => void }>()
const send = (method: string, params: Record<string, unknown> = {}): Promise<Reply> =>
  new Promise((ok, fail) => {
    waiting.set(++seq, { resolve: ok, reject: fail })
    ws.send(JSON.stringify({ id: seq, method, params }))
  })
async function run(expression: string): Promise<unknown> {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

function psnr(a: string, b: string): string {
  // ffmpeg prints the figure on stderr
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' })
  return /average:(\S+)/.exec(r.stderr)?.[1] ?? '?'
}

async function main() {
  await lockGpu()
  await mkdir(OUT, { recursive: true })
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), `strange-attractors-stills-${PORT}`)}`, `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' })
  process.on('exit', () => {
    chrome.kill()
    unlockGpu()
  })
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: inject })

  const ids = SCREENPLAY.map((s) => s.id)
  const dt = 1000 / 60
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
    let at = 0
    for (const t of shot.times) {
      let left = Math.round((t - at) * 60)
      while (left > 0) {
        const r = JSON.parse(String(await run(`window.__cap.skip(${dt}, 1e9, ${Math.min(left, 600)})`))) as { frames: number; status: string }
        left -= r.frames
        if (r.status === 'ended') break
      }
      at = t
      await run(`window.__cap.frame(${dt})`)
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const name = `${shot.id}-${String(t).padStart(3, '0')}.png`
      await writeFile(join(OUT, name), Buffer.from(r.data ?? '', 'base64'))
      let note = ''
      if (COMPARE) {
        const other = join(resolve(COMPARE), name)
        note = existsSync(other) ? `  PSNR ${psnr(other, join(OUT, name))} dB` : '  (nothing to compare with)'
      }
      console.log(`${join(OUT, name)}${note}`)
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
