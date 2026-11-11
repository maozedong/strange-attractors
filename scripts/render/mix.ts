/**
 * Builds the soundtrack for a render.
 *
 *   pnpm mix -- --in renders/film            # reads timeline.json, writes mix.wav beside it
 *   pnpm mix -- --in renders/film --stems    # also bed.wav (no narration) and voice.wav
 *
 * The mixing itself happens in a headless Chrome (scripts/render/mix.js), because the film's
 * sound is a Web Audio graph and the offline version of the same graph is the faithful copy.
 */
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, normalize, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const IN = resolve(arg('in', 'renders/film'))
const PORT = Number(arg('port', '9371'))
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const PUBLIC = resolve('public')
const HERE = new URL('.', import.meta.url).pathname
const STEMS = argv.includes('--stems') ? { mix: [], bed: ['voice'], voice: ['music', 'sfx', 'notes'] } : { mix: [] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const send = (file: string, type: string) => {
    stat(file).then(
      () => {
        res.writeHead(200, { 'content-type': type })
        createReadStream(file).pipe(res)
      },
      () => {
        res.writeHead(404)
        res.end()
      },
    )
  }
  if (req.method === 'POST' && url.pathname === '/out') {
    const name = (url.searchParams.get('name') ?? 'mix.wav').replace(/[^a-z0-9.-]/gi, '')
    pipeline(req, createWriteStream(join(IN, name))).then(
      () => res.end('ok'),
      () => {
        res.writeHead(500)
        res.end()
      },
    )
  } else if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><meta charset="utf-8"><script src="/mix.js"></script>')
  } else if (url.pathname === '/mix.js') send(join(HERE, 'mix.js'), 'text/javascript')
  else if (url.pathname === '/timeline.json') send(join(IN, 'timeline.json'), 'application/json')
  else if (url.pathname.startsWith('/public/')) {
    const file = normalize(join(PUBLIC, url.pathname.slice('/public/'.length)))
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(403)
      res.end()
    } else send(file, file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream')
  } else {
    res.writeHead(404)
    res.end()
  }
})

async function main() {
  await readFile(join(IN, 'timeline.json'))
  await new Promise<void>((r) => server.listen(PORT + 1, '127.0.0.1', r))
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(IN, '.chrome-mix')}`, 'about:blank'], { stdio: 'ignore' })
  process.on('exit', () => chrome.kill())

  let target: { webSocketDebuggerUrl: string } | null = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:${PORT + 1}/`, { method: 'PUT' })
      if (r.ok) target = (await r.json()) as { webSocketDebuggerUrl: string }
    } catch {
      await sleep(200)
    }
  }
  if (!target) throw new Error('Chrome did not start')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((ok) => ws.addEventListener('open', () => ok()))
  const call = (expression: string) =>
    new Promise<string>((ok, fail) => {
      ws.addEventListener('message', (m) => {
        const msg = JSON.parse(String(m.data)) as { id?: number; result?: { result?: { value?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } } }
        if (msg.id !== 1) return
        const ex = msg.result?.exceptionDetails
        if (ex) fail(new Error(ex.exception?.description ?? ex.text))
        else ok(msg.result?.result?.value ?? '')
      })
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  for (let i = 0; i < 50; i++) {
    await sleep(200)
    const ready = await new Promise<boolean>((ok) => {
      const id = 1000 + i
      const on = (m: MessageEvent) => {
        const msg = JSON.parse(String(m.data)) as { id?: number; result?: { result?: { value?: boolean } } }
        if (msg.id !== id) return
        ws.removeEventListener('message', on)
        ok(msg.result?.result?.value === true)
      }
      ws.addEventListener('message', on)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `typeof window.run === 'function'`, returnByValue: true } }))
    })
    if (ready) break
  }
  const report = await call(`window.run(${JSON.stringify(STEMS)})`)
  console.log('mixed:', report)
  server.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
