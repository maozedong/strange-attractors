/**
 * Renders the film to video, frame by frame, from the page itself.
 *
 *   pnpm dev --port 5199                                  # the film, served locally
 *   pnpm render -- --out renders/film                     # the whole film, 3840×2160 at 60 fps
 *   pnpm render -- --out renders/twins --from twins --to twins --captions 1
 *   pnpm render -- --out renders/tall --width 360 --height 640 --dsf 3 --from fireflies --to fireflies
 *
 * A headless Chrome opens the film in ?cinema mode with scripts/render/inject.js in front of it:
 * the page's clock only moves when this script asks for a frame, so each frame is exactly one
 * sixtieth of a second of film however long it takes to draw and capture. Frames are piped into
 * ffmpeg, one file per scene (seg-NN-<id>.mp4). Sound is not recorded here: the page writes down
 * what it would have played, with film times, into timeline.json, and scripts/render/mix.ts
 * builds the soundtrack from that.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SCREENPLAY } from '../../src/film/screenplay'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const flag = (name: string) => argv.includes(`--${name}`)

const OUT = resolve(arg('out', 'renders/film'))
const URL_BASE = arg('url', 'http://localhost:5199/')
const WIDTH = Number(arg('width', '1920'))
const HEIGHT = Number(arg('height', '1080'))
const DSF = Number(arg('dsf', '2'))
const FPS = Number(arg('fps', '60'))
const CAPTIONS = arg('captions', '0')
const DUST = arg('n', '512')
const FROM = arg('from', '')
const TO = arg('to', '')
/** seconds of title before the film begins (whole film only) */
/**
 * --whole: the film is played from its title, as one continuous run, and --from/--to only choose
 * which scenes are kept. Several of these side by side render the film in parallel, and their
 * files join without a seam because every worker has lived the same film up to its first frame.
 * Without it, --from starts the film cold at that scene (clips).
 */
const WHOLE = flag('whole') || !(FROM || TO)
const TITLE = Number(arg('title', WHOLE ? '7' : '0'))
/** seconds the picture holds after the last scene (whole film: the end card) */
const TAIL = Number(arg('tail', WHOLE ? '16' : '0'))
/** stop after this many seconds of film (tests) */
const LIMIT = Number(arg('limit', '0'))
const CRF = arg('crf', '14')
const PRESET = arg('preset', 'fast')
const FORMAT = arg('format', 'png') === 'jpeg' ? 'jpeg' : 'png'
const PORT = Number(arg('port', '9351'))
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
/** keep every Nth frame as a still, for checking the render without playing it */
const STILLS = Number(arg('stills', '0'))
const END_CARD = flag('end-card') || WHOLE
/**
 * Film grain. On a screen the film's per-pixel grain (0.006) hides banding; in a video file it is
 * noise the encoder cannot afford, and a streaming site's second encode turns it to mush.
 */
const GRAIN = Number(arg('grain', '0.0006'))
/** for clips: scenes played, uncaptured, before the first one that is kept */
const PREROLL = Number(arg('preroll', '0'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ───────────── Chrome over its debugging protocol ─────────────

class Page {
  private id = 0
  private readonly waiting = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> }
      if (msg.id !== undefined) {
        const w = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        if (msg.error) w?.reject(new Error(msg.error.message))
        else w?.resolve(msg.result ?? {})
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.warn('[page]', JSON.stringify(msg.params).slice(0, 600))
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const p = msg.params as { type: string; args: { value?: unknown; description?: string }[] }
        if (p.type === 'error' || p.type === 'warning') console.warn(`[page ${p.type}]`, p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400))
      }
    })
  }

  static async open(port: number): Promise<Page> {
    let target: { webSocketDebuggerUrl: string } | null = null
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
        if (r.ok) target = (await r.json()) as { webSocketDebuggerUrl: string }
      } catch {
        await sleep(200)
      }
    }
    if (!target) throw new Error('Chrome did not start')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((ok, fail) => {
      ws.addEventListener('open', () => ok())
      ws.addEventListener('error', () => fail(new Error('could not reach the page')))
    })
    return new Page(ws)
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async run<T>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result: { value: T }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  async shot(): Promise<Buffer> {
    const r = (await this.send('Page.captureScreenshot', { format: FORMAT, quality: 96, optimizeForSpeed: true, captureBeyondViewport: false })) as { data: string }
    return Buffer.from(r.data, 'base64')
  }
}

// ───────────── frames into files ─────────────

class Reel {
  private proc: ChildProcess | null = null
  private done: Promise<unknown> = Promise.resolve()
  frames = 0

  open(file: string) {
    const input = FORMAT === 'png' ? ['-c:v', 'png'] : ['-c:v', 'mjpeg']
    // screenshots are full-range sRGB; the file is limited-range BT.709, which is what players assume
    const filter = FORMAT === 'png' ? 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p' : 'scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p'
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), ...input, '-i', '-', '-vf', filter]
    args.push('-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-g', String(FPS / 2), '-bf', '2')
    args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', file)
    const p = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] })
    this.proc = p
    this.done = once(p, 'exit')
    this.frames = 0
  }

  async write(frame: Buffer) {
    const stdin = this.proc?.stdin
    if (!stdin) throw new Error('no reel open')
    this.frames++
    if (!stdin.write(frame)) await once(stdin, 'drain')
  }

  async close() {
    if (!this.proc) return
    this.proc.stdin?.end()
    await this.done
    this.proc = null
  }
}

interface SoundEvent {
  t: number
  k: string
  [key: string]: unknown
}
interface FrameReport {
  t: number
  status: string
  index: number
  events: SoundEvent[]
}
interface Segment {
  name: string
  file: string
  index: number
  start: number
  frames: number
}

const END_CARD_CSS = `
#cap-end { position: fixed; inset: 0; z-index: 50; pointer-events: none; color: #f3efe6; font-family: var(--serif); opacity: 0; transition: opacity 2.4s ease; }
#cap-end.is-on { opacity: 1; }
#cap-end .end__in { position: absolute; left: 6.5vw; bottom: 11vh; max-width: 40vw; }
#cap-end p { margin: 0; }
#cap-end .end__lead { font-size: 2.05vw; line-height: 1.25; font-variation-settings: 'opsz' 40, 'SOFT' 50; text-shadow: 0 0 24px rgba(0,0,0,.9); }
#cap-end .end__url { margin-top: 1.1vw; font-family: var(--mono); font-size: 1.12vw; letter-spacing: .04em; color: var(--accent, #9fc4ff); text-shadow: 0 0 18px rgba(0,0,0,.9); }
#cap-end .end__credits { margin-top: 2.3vw; font-family: var(--mono); font-size: .74vw; line-height: 1.7; letter-spacing: .05em; opacity: .62; text-transform: uppercase; }
#cap-open { position: fixed; left: 0; right: 0; top: 54vh; z-index: 50; text-align: center; pointer-events: none; color: #f3efe6; font-family: var(--serif); font-size: 1.5vw; line-height: 1.4; font-variation-settings: 'opsz' 30, 'SOFT' 50; opacity: 0; transition: opacity 1.6s ease; text-shadow: 0 0 22px rgba(0,0,0,.9); }
#cap-open.is-on { opacity: .86; }
#cap-open span { display: block; margin-top: .9vw; font-family: var(--mono); font-size: .78vw; letter-spacing: .14em; text-transform: uppercase; opacity: .6; }
#cap-black { position: fixed; inset: 0; z-index: 60; background: #000; pointer-events: none; opacity: 0; transition: opacity 1.3s ease; }
#cap-black.is-on { opacity: 1; }
#cap-black.is-open { opacity: 1; transition: none; }
`
const END_CARD_HTML = `<div class="end__in">
  <p class="end__lead">Every frame of this film was computed live, in a web browser. Open it, and every scene is yours to play with.</p>
  <p class="end__url">${arg('link', 'maozedong.github.io/strange-attractors')}</p>
  <p class="end__credits">Narration and music generated with ElevenLabs<br>Coastline data: Natural Earth · Cat: Alicja Koczaska (CC0)</p>
</div>`

const OPEN_HTML = `A film about chaos, fractals and the order that appears from nothing.<span>Every point of light is computed as you watch</span>`

async function main() {
  await mkdir(OUT, { recursive: true })
  if (STILLS) await mkdir(join(OUT, 'stills'), { recursive: true })
  const inject = await readFile(new URL('./inject.js', import.meta.url), 'utf8')
  const ids = SCREENPLAY.map((s) => s.id)
  const first = FROM ? ids.indexOf(FROM) : 0
  const last = TO ? ids.indexOf(TO) : ids.length - 1
  if (first < 0 || last < first) throw new Error(`no such range: ${FROM}..${TO}`)

  const profile = join(OUT, '.chrome')
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'],
    { stdio: 'ignore' },
  )
  const quit = () => chrome.kill()
  process.on('exit', quit)
  process.on('SIGINT', () => process.exit(1))
  process.on('SIGTERM', () => process.exit(1))

  const page = await Page.open(PORT)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DSF, mobile: false })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: inject })
  await page.send('Page.navigate', { url: `${URL_BASE}?cinema&n=${DUST}&captions=${CAPTIONS}&dpr=${DSF}` })

  const dt = 1000 / FPS
  for (let i = 0; ; i++) {
    await sleep(100)
    const ok = await page.run<boolean>(`window.__cap ? window.__cap.pump(${dt}).then(() => window.__cap.ready(${JSON.stringify(ids)})) : false`).catch(() => false)
    if (ok) break
    if (i > 600) throw new Error('the film did not load')
  }

  await page.run(`window.strangeAttractors.engine.post.film.uniforms.get('uGrain').value = ${GRAIN}`)
  const keepTitle = WHOLE && TITLE > 0 && first === 0
  const keepTail = TAIL > 0 && (!WHOLE || last === ids.length - 1)
  const reel = new Reel()
  const segments: Segment[] = []
  const events: SoundEvent[] = []
  let frame = 0
  let t0 = NaN
  let current: Segment | null = null
  /** the bed that was playing when this worker started keeping frames */
  let bed: SoundEvent | null = null
  const began = Date.now()
  const spent = [0, 0, 0]

  const cut = async (name: string, index: number) => {
    await reel.close()
    if (current) current.frames = frame - current.start
    const file = `seg-${String(segments.length).padStart(2, '0')}-${name}.mp4`
    current = { name, file, index, start: frame, frames: 0 }
    segments.push(current)
    reel.open(join(OUT, file))
  }

  const save = async () => {
    if (current) current.frames = frame - current.start
    await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ fps: FPS, width: WIDTH * DSF, height: HEIGHT * DSF, frames: frame, seconds: frame / FPS, segments, events }, null, 1))
  }

  /** advance one frame of film, capture it, and note what the sound was asked to do */
  const take = async (): Promise<FrameReport> => {
    const a = performance.now()
    const report = JSON.parse(await page.run<string>(`window.__cap.frame(${dt})`)) as FrameReport
    if (Number.isNaN(t0)) {
      t0 = report.t
      // a clip that starts mid-film still needs to know what music it is in
      if (bed && !report.events.some((e) => e.k === 'music')) events.push({ ...bed, t: 0 })
    }
    for (const e of report.events) events.push({ ...e, t: Math.max(0, e.t - t0) })
    const b = performance.now()
    const shot = await page.shot()
    const c = performance.now()
    await reel.write(shot)
    spent[0] += b - a
    spent[1] += c - b
    spent[2] += performance.now() - c
    if (STILLS && frame % STILLS === 0) await writeFile(join(OUT, 'stills', `f${String(frame).padStart(6, '0')}.${FORMAT === 'png' ? 'png' : 'jpg'}`), shot)
    frame++
    if (frame % 300 === 0) {
      const rate = frame / ((Date.now() - began) / 1000)
      console.log(`${(frame / FPS).toFixed(0).padStart(5)} s of film  ${current?.name ?? ''}  ${rate.toFixed(2)} frames/s  (step ${(spent[0] / 300).toFixed(0)} ms, capture ${(spent[1] / 300).toFixed(0)} ms, encode ${(spent[2] / 300).toFixed(0)} ms)`)
      spent.fill(0)
      await save()
    }
    return report
  }

  // Catching up costs nothing to look at, so it is drawn small: the film's state (simulations,
  // camera, words) does not depend on how many pixels the canvas has. Full size comes back two
  // scenes before the first kept frame, so everything on screen by then was set up at full size.
  const setDpr = (v: number) => page.run(`(() => { const e = window.strangeAttractors.engine; e.dpr = ${v}; e.resize() })()`)
  let small = false
  if (WHOLE && first > 2) {
    small = true
    await setDpr(0.25)
  }

  /**
   * Film that is not kept (another worker has it, or it is before the clip): run in the page in
   * long strides, until the film reaches scene `until` or `max` frames have passed.
   */
  let skipped = 0
  const skip = async (until: number, max: number): Promise<FrameReport> => {
    let left = max
    for (;;) {
      const r = JSON.parse(await page.run<string>(`window.__cap.skip(${dt}, ${until}, ${Math.min(left, 600)})`)) as FrameReport & { frames: number; music: SoundEvent | null }
      if (r.music) bed = r.music
      left -= r.frames
      skipped += r.frames
      if (Math.floor(skipped / 3600) !== Math.floor((skipped - r.frames) / 3600)) console.log(`catching up: ${(skipped / FPS / 60).toFixed(0)} min of film, at ${ids[r.index] ?? 'title'}`)
      if (left <= 0 || r.index >= until || r.status === 'ended') return r
    }
  }

  await page.run(`window.__cap.overlay('cap-black', '', ${JSON.stringify(END_CARD_CSS)})`)

  let keeping = false
  let index = -2
  if (WHOLE) {
    // the title forms out of the dark
    await page.run(`window.__cap.addClass('cap-black', 'is-open')`)
    for (let i = 0; i < 30; i++) await page.run(`window.__cap.pump(${dt})`)
    if (keepTitle) {
      keeping = true
      await cut('title', -1)
    }
    await page.run(`document.getElementById('cap-black').className = ''`)
    await page.run(`window.__cap.overlay('cap-open', ${JSON.stringify(OPEN_HTML)})`)
    if (keeping) {
      for (let i = 0; i < TITLE * FPS; i++) {
        if (i === Math.round(1.6 * FPS)) await page.run(`window.__cap.addClass('cap-open', 'is-on')`)
        if (i === Math.round((TITLE - 1.9) * FPS)) await page.run(`document.getElementById('cap-open').className = ''`)
        await take()
      }
    } else {
      await skip(1e9, TITLE * FPS)
    }
    await page.run(`document.getElementById('cap-open').className = ''`)
    await page.run(`window.__cap.begin(0)`)
  } else {
    const start = Math.max(0, first - PREROLL)
    if (start === first) {
      keeping = true
      index = first
      await cut(ids[first], first)
    }
    await page.run(`window.__cap.begin(${start})`)
  }

  if (!keeping) {
    // to two scenes before the first kept one, small; then at full size up to the frame on which
    // the film moves on to it (that frame stays with the worker rendering the scene before)
    if (small) {
      await skip(first - 2, 1e9)
      small = false
      await setDpr(DSF)
    }
    await skip(first, 1e9)
    keeping = true
    index = first
    await cut(ids[first], first)
  }

  for (;;) {
    const r = await take()
    if (r.index !== index && r.status !== 'ended') {
      // the frame on which the film moves on stays with the scene being left
      index = r.index
      if (index > last) break
      await cut(ids[index], index)
    }
    if (r.status === 'ended') break
    if (LIMIT && frame / FPS >= LIMIT) break
  }

  if (keepTail) {
    if (END_CARD) {
      await cut('end', ids.length)
      await page.run(`window.__cap.overlay('cap-end', ${JSON.stringify(END_CARD_HTML)})`)
      for (let i = 0; i < FPS; i++) await take()
      await page.run(`window.__cap.addClass('cap-end', 'is-on')`)
    }
    const fadeAt = Math.round((TAIL - 1.5) * FPS)
    events.push({ t: frame / FPS + TAIL - 5, k: 'musicFade', seconds: 4.5 })
    for (let i = 0; i < TAIL * FPS; i++) {
      if (i === fadeAt) await page.run(`window.__cap.addClass('cap-black', 'is-on')`)
      await take()
    }
  }

  await reel.close()
  await save()
  console.log(`done: ${frame} frames (${(frame / FPS).toFixed(1)} s) in ${((Date.now() - began) / 60000).toFixed(1)} min → ${OUT}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
