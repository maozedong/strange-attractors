/**
 * Joins what the render workers made into one film.
 *
 *   pnpm assemble -- --in renders/film/w0,renders/film/w1 --out renders/film/out
 *
 * Writes, into --out: timeline.json (every worker's scenes and sound events on one clock),
 * picture.mp4 (the scene files joined without re-encoding), captions.srt (the narration, timed
 * from when each clip started in this render), chapters.txt (for a video description). Then
 * `pnpm mix -- --in <out>` makes the soundtrack and `--mux` here puts the two together.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ACTS, SCREENPLAY, lineText, segmentsOf } from '../../src/film/screenplay'

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const OUT = resolve(arg('out', 'renders/film/out'))
const INS = arg('in', '').split(',').filter(Boolean).map((d) => resolve(d))

interface Seg {
  name: string
  file: string
  index: number
  start: number
  frames: number
}
interface Ev {
  t: number
  k: string
  stem?: string
  [key: string]: unknown
}
interface Timeline {
  fps: number
  width: number
  height: number
  frames: number
  seconds: number
  segments: Seg[]
  events: Ev[]
}

const stamp = (t: number, sep: string) => {
  const ms = Math.max(0, Math.round(t * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

if (argv.includes('--mux')) {
  const name = arg('name', 'film.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(OUT, 'picture.mp4'), '-i', join(OUT, arg('audio', 'mix.wav')), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-shortest', '-movflags', '+faststart', join(OUT, name)], { stdio: 'inherit' })
  console.log(`→ ${join(OUT, name)}`)
  process.exit(0)
}

if (INS.length === 0) throw new Error('--in <dir,dir,…>')
mkdirSync(OUT, { recursive: true })

const all: Timeline = { fps: 0, width: 0, height: 0, frames: 0, seconds: 0, segments: [], events: [] }
const list: string[] = []
for (const dir of INS) {
  const t = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')) as Timeline
  all.fps = t.fps
  all.width = t.width
  all.height = t.height
  for (const s of t.segments) {
    if (s.frames <= 0) continue
    all.segments.push({ ...s, file: join(dir, s.file), start: all.frames + s.start })
    list.push(`file '${join(dir, s.file)}'`)
  }
  for (const e of t.events) all.events.push({ ...e, t: e.t + all.frames / t.fps })
  all.frames += t.frames
}
all.seconds = all.frames / all.fps
all.events.sort((a, b) => a.t - b.t)
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(all, null, 1))
writeFileSync(join(OUT, 'concat.txt'), list.join('\n') + '\n')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(OUT, 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', join(OUT, 'picture.mp4')], { stdio: 'inherit' })

// ───────────── captions ─────────────
const timing = JSON.parse(readFileSync(resolve('public/vo/timing.json'), 'utf8')) as Record<string, ({ dur: number; lines: { s: number; e: number }[] } | null)[]>
const cues: { a: number; b: number; text: string }[] = []
for (const e of all.events) {
  if (e.k !== 'voice' || !e.stem) continue
  const m = /^(.*)-(\d+)$/.exec(e.stem)
  if (!m) continue
  const scene = SCREENPLAY.find((s) => s.id === m[1])
  const seg = scene ? segmentsOf(scene)[Number(m[2]) - 1] : undefined
  const tm = timing[m[1]]?.[Number(m[2]) - 1]
  if (!seg || !tm) continue
  seg.lines.forEach((line, k) => {
    const lt = tm.lines[k]
    if (lt) cues.push({ a: e.t + lt.s - 0.05, b: e.t + lt.e + 0.9, text: lineText(line) })
  })
}
cues.sort((x, y) => x.a - y.a)
cues.forEach((c, i) => {
  const next = cues[i + 1]
  if (next && c.b > next.a - 0.04) c.b = next.a - 0.04
})
writeFileSync(join(OUT, 'captions.srt'), cues.map((c, i) => `${i + 1}\n${stamp(c.a, ',')} --> ${stamp(c.b, ',')}\n${c.text}\n`).join('\n'))

// ───────────── chapters ─────────────
const chapters: string[] = []
let act = -1
for (const s of all.segments) {
  if (s.index < 0 || s.index >= SCREENPLAY.length) continue
  const scene = SCREENPLAY[s.index]
  const t = s.index === 0 ? 0 : s.start / all.fps
  const info = ACTS.find((a) => a.act === scene.act)
  const part = scene.act !== act && info?.numeral ? `Part ${info.numeral}: ${info.title} · ` : ''
  act = scene.act
  chapters.push(`${clock(t)} ${part}${scene.title}`)
}
writeFileSync(join(OUT, 'chapters.txt'), chapters.join('\n') + '\n')
console.log(`${all.segments.length} scenes, ${clock(all.seconds)}, ${cues.length} captions → ${OUT}`)
