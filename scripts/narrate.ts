/**
 * Records the narration with ElevenLabs and measures when every word is spoken.
 *
 *   ELEVEN_API_KEY=... pnpm narrate                 # record whatever is missing or changed
 *   pnpm narrate -- --only twins,swarm              # just these scenes
 *   pnpm narrate -- --force                         # everything again
 *   pnpm narrate -- --timing                        # rebuild timing.json from the files on disk
 *
 * One mp3 per segment of a scene (a scene is split at its gates): public/vo/<scene>-<n>.mp3.
 * public/vo/timing.json holds, per scene and segment, the duration and for every line its start,
 * its end and the start of each word, from forced alignment of the finished audio. A hash of the
 * spoken text is kept so only edited segments are recorded again.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { SCREENPLAY, lineSay, segmentStem, segmentsOf } from '../src/film/screenplay'

const API = 'https://api.elevenlabs.io/v1'
const KEY = process.env.ELEVEN_API_KEY ?? process.env.ELEVENLABS_API_KEY
const OUT = join(process.cwd(), 'public', 'vo')
const TIMING = join(OUT, 'timing.json')

/** George: a warm, unhurried storyteller. */
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'
const MODEL_ID = 'eleven_v4_turbo'

const args = process.argv.slice(2)
const force = args.includes('--force')
const timingOnly = args.includes('--timing')
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(',')) : null

interface LineTiming {
  /** start, end (seconds within the segment) */
  s: number
  e: number
  /** start of each word of the spoken text */
  w: number[]
}
interface SegmentTiming {
  hash: string
  dur: number
  lines: LineTiming[]
}
type Timing = Record<string, SegmentTiming[]>

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

const hashOf = (text: string) => createHash('sha1').update(`${VOICE_ID}|${MODEL_ID}|${text}`).digest('hex').slice(0, 12)

async function tts(text: string, previous: string | undefined, next: string | undefined): Promise<Buffer> {
  const r = await fetch(`${API}/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      language_code: 'en',
      apply_text_normalization: 'on',
      // stitching keeps pace and tone continuous from one segment to the next
      previous_text: previous,
      next_text: next,
      seed: 11,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 0.95 },
    }),
  })
  if (!r.ok) throw new Error(`text-to-speech ${r.status}: ${await r.text()}`)
  return Buffer.from(await r.arrayBuffer())
}

/** even loudness across segments, mono, small */
function master(raw: string, out: string) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', 'loudnorm=I=-19:TP=-2:LRA=9', '-ac', '1', '-ar', '44100', '-b:a', '88k', out])
}

function duration(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
}

async function align(file: string, text: string): Promise<{ start: number; end: number }[]> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)], { type: 'audio/mpeg' }), 'a.mp3')
  form.append('text', text)
  const r = await fetch(`${API}/forced-alignment`, { method: 'POST', headers: { 'xi-api-key': KEY! }, body: form })
  if (!r.ok) throw new Error(`forced-alignment ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as { characters: { text: string; start: number; end: number }[] }
  return j.characters
}

function lineTimings(says: string[], chars: { start: number; end: number }[]): LineTiming[] {
  const out: LineTiming[] = []
  let at = 0
  for (const say of says) {
    const a = at
    const b = at + say.length
    const w: number[] = []
    for (let i = 0; i < say.length; i++) {
      if (say[i] !== ' ' && (i === 0 || say[i - 1] === ' ')) w.push(round(chars[Math.min(chars.length - 1, a + i)].start))
    }
    out.push({ s: round(chars[Math.min(chars.length - 1, a)].start), e: round(chars[Math.min(chars.length - 1, b - 1)].end), w })
    at = b + 1 // the joining space
  }
  return out
}

const round = (x: number) => Math.round(x * 1000) / 1000

async function main() {
  if (!KEY) {
    console.error('ELEVEN_API_KEY is not set')
    process.exit(1)
  }
  await mkdir(OUT, { recursive: true })
  const timing: Timing = (await exists(TIMING)) ? (JSON.parse(await readFile(TIMING, 'utf8')) as Timing) : {}

  // every segment in film order, so each can be stitched to its neighbours
  const all = SCREENPLAY.flatMap((scene) =>
    segmentsOf(scene).map((seg, i) => ({ scene, i, says: seg.lines.map(lineSay), text: seg.lines.map(lineSay).join(' ') })),
  )

  let recorded = 0
  let chars = 0
  for (let k = 0; k < all.length; k++) {
    const { scene, i, says, text } = all[k]
    if (only && !only.has(scene.id)) continue
    const stem = segmentStem(scene.id, i)
    const file = join(OUT, `${stem}.mp3`)
    const hash = hashOf(text)
    const have = timing[scene.id]?.[i]
    const fresh = have?.hash === hash && (await exists(file))
    if (fresh && !force && !timingOnly) continue

    if (!timingOnly || !(await exists(file))) {
      const raw = join(OUT, `${stem}.raw.mp3`)
      await writeFile(raw, await tts(text, all[k - 1]?.text, all[k + 1]?.text))
      master(raw, file)
      await unlink(raw)
      recorded++
      chars += text.length
    }
    const aligned = await align(file, text)
    if (aligned.length !== text.length) {
      console.warn(`${stem}: alignment returned ${aligned.length} characters for ${text.length}`)
    }
    const seg: SegmentTiming = { hash, dur: round(duration(file)), lines: lineTimings(says, aligned) }
    timing[scene.id] = timing[scene.id] ?? []
    timing[scene.id][i] = seg
    // write as we go: an interrupted run loses nothing
    await writeFile(`${TIMING}.tmp`, JSON.stringify(timing))
    await rename(`${TIMING}.tmp`, TIMING)
    console.log(`${stem.padEnd(16)} ${seg.dur.toFixed(1).padStart(5)} s  ${text.length} chars`)
  }

  // drop scenes that left the screenplay
  for (const id of Object.keys(timing)) if (!SCREENPLAY.some((s) => s.id === id)) delete timing[id]
  await writeFile(TIMING, JSON.stringify(timing))

  const total = Object.values(timing).reduce((sum, segs) => sum + segs.reduce((a, s) => a + (s?.dur ?? 0), 0), 0)
  console.log(`\nrecorded ${recorded} segments (${chars} characters). Narration on disk: ${(total / 60).toFixed(1)} min.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
