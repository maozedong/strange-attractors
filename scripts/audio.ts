/**
 * Generates the narration and sound effects with ElevenLabs into public/audio/.
 * Idempotent: files that already exist are skipped, so a re-run only fills gaps.
 *
 *   ELEVEN_API_KEY=... pnpm audio            # everything missing
 *   pnpm audio -- --only vo-swarm,sfx-turn   # specific stems
 *   pnpm audio -- --force                    # regenerate even if present
 */
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NARRATION, NARRATION_ORDER, SFX } from '../src/audio/script'

const API = 'https://api.elevenlabs.io/v1'
const KEY = process.env.ELEVEN_API_KEY ?? process.env.ELEVENLABS_API_KEY
const OUT = join(process.cwd(), 'public', 'audio')

/** George: warm, captivating storyteller (premade). */
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'
const MODEL_ID = 'eleven_v4_turbo'

const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null

if (!KEY) {
  console.error('ELEVEN_API_KEY is not set')
  process.exit(1)
}

async function exists(p: string) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function usage() {
  const r = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': KEY! } })
  const j = (await r.json()) as { character_count: number; character_limit: number; tier: string }
  return `${j.character_count} / ${j.character_limit} characters used (${j.tier})`
}

async function tts(stem: string, text: string, previous?: string, next?: string) {
  const file = join(OUT, `${stem}.mp3`)
  if (!force && (await exists(file))) return console.log(`skip  ${stem} (exists)`)
  if (only && !only.has(stem)) return
  const r = await fetch(`${API}/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      language_code: 'en',
      // numbers and symbols read out properly ("0.506127", "ρ")
      apply_text_normalization: 'on',
      // request stitching: keeps pace and tone continuous from chapter to chapter
      previous_text: previous,
      next_text: next,
      seed: 7,
      voice_settings: {
        stability: 0.5, // "natural": expressive but steady, right for a documentary read
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
        speed: 0.95, // a touch slower than default; the pictures need time
      },
    }),
  })
  if (!r.ok) throw new Error(`${stem}: ${r.status} ${await r.text()}`)
  await writeFile(file, Buffer.from(await r.arrayBuffer()))
  console.log(`wrote ${stem} (${text.length} chars)`)
}

/**
 * Word timings for a narration, via forced alignment of the finished mp3 against its
 * script. Written as public/audio/<stem>.json: { t: [start seconds per character] }
 * so the app can find the moment any phrase of the script is spoken.
 */
async function align(stem: string, text: string) {
  const mp3 = join(OUT, `${stem}.mp3`)
  const file = join(OUT, `${stem}.json`)
  if (!(await exists(mp3))) return
  if (!force && (await exists(file))) return console.log(`skip  ${stem}.json (exists)`)
  if (only && !only.has(stem) && !only.has(`${stem}.json`)) return
  const form = new FormData()
  form.append('file', new Blob([await readFile(mp3)], { type: 'audio/mpeg' }), `${stem}.mp3`)
  form.append('text', text)
  const r = await fetch(`${API}/forced-alignment`, { method: 'POST', headers: { 'xi-api-key': KEY! }, body: form })
  if (!r.ok) throw new Error(`${stem} alignment: ${r.status} ${await r.text()}`)
  const j = (await r.json()) as { characters: { text: string; start: number; end: number }[]; loss: number }
  // the service returns one entry per character of `text`, in order
  const t = j.characters.map((c) => Math.round(c.start * 1000) / 1000)
  if (t.length !== text.length) console.warn(`${stem}: alignment has ${t.length} chars, script has ${text.length}`)
  await writeFile(file, JSON.stringify({ t, loss: Math.round(j.loss * 1000) / 1000 }))
  console.log(`wrote ${stem}.json (loss ${j.loss.toFixed(2)})`)
}

async function sfx(stem: string, prompt: string, seconds: number, loop = false) {
  const file = join(OUT, `${stem}.mp3`)
  if (!force && (await exists(file))) return console.log(`skip  ${stem} (exists)`)
  if (only && !only.has(stem)) return
  const r = await fetch(`${API}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: seconds,
      prompt_influence: 0.4,
      loop,
    }),
  })
  if (!r.ok) throw new Error(`${stem}: ${r.status} ${await r.text()}`)
  await writeFile(file, Buffer.from(await r.arrayBuffer()))
  console.log(`wrote ${stem} (${seconds}s)`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log('before:', await usage())
  for (let i = 0; i < NARRATION_ORDER.length; i++) {
    const id = NARRATION_ORDER[i]
    if (!NARRATION[id]) continue // script not written yet
    await tts(`vo-${id}`, NARRATION[id], NARRATION[NARRATION_ORDER[i - 1]], NARRATION[NARRATION_ORDER[i + 1]])
  }
  for (const id of NARRATION_ORDER) if (NARRATION[id]) await align(`vo-${id}`, NARRATION[id])
  for (const s of SFX) await sfx(`sfx-${s.id}`, s.prompt, s.seconds, s.loop)
  console.log('after: ', await usage())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
