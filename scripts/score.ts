/**
 * Generates the score with ElevenLabs Music: one slow bed per act, mastered to sit under the
 * narrator (quiet, low end thinned, faded at both ends so the loop point is a breath).
 *
 *   ELEVEN_API_KEY=... pnpm score              # whatever is missing
 *   pnpm score -- --only water,moss            # just these
 *   pnpm score -- --force
 *
 * Writes public/music/<id>.mp3. The film maps acts to beds in src/film/Film.ts.
 */
import { execFileSync } from 'node:child_process'
import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const KEY = process.env.ELEVEN_API_KEY ?? process.env.ELEVENLABS_API_KEY
const OUT = join(process.cwd(), 'public', 'music')
const SECONDS = 150

const COMMON =
  'Instrumental underscore for a calm science documentary, to sit quietly beneath a deep male narrator: leave the low register nearly empty, keep everything soft and slow. No drums, no percussion, no beat, no vocals, no lyrics, no sudden changes, no big crescendo. It should be able to loop.'

const BEDS: { id: string; prompt: string }[] = [
  {
    id: 'storm',
    prompt: `Night air before a storm. Warm analogue synth pads in D minor moving very slowly, a soft sustained string harmonic high above, single felt-piano notes far apart with long reverb. Mysterious, patient, a little uneasy. ${COMMON}`,
  },
  {
    id: 'water',
    prompt: `Still dark water. Glassy bell tones and a celesta, slow harp harmonics, a soft bowed-glass pad; notes fall like single drops into a pool and ring. Curious, crystalline, precise. ${COMMON}`,
  },
  {
    id: 'moss',
    prompt: `A forest floor in soft light. Warm clarinet and viola pads, gentle kalimba and nylon guitar harmonics, slow breathing chords in a major key with a modal tint. Organic, tender, full of quiet wonder. ${COMMON}`,
  },
  {
    id: 'brass',
    prompt: `Dusk over a wide landscape. Soft french horns and muted low brass swelling slowly, a bowed cello line held for a long time, distant tubular bell once in a while. Grave, wide, dignified. ${COMMON}`,
  },
  {
    id: 'phosphor',
    prompt: `Fireflies over a river at night. Shimmering high synth textures, a wordless choir-like pad very far away, gentle pulsing tones that drift in and out of step, warm major harmony. Luminous, hopeful, at peace. ${COMMON}`,
  },
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(',')) : null

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

async function main() {
  if (!KEY) {
    console.error('ELEVEN_API_KEY is not set')
    process.exit(1)
  }
  await mkdir(OUT, { recursive: true })
  for (const bed of BEDS) {
    if (only && !only.has(bed.id)) continue
    const file = join(OUT, `${bed.id}.mp3`)
    if (!force && (await exists(file))) {
      console.log(`skip  ${bed.id}`)
      continue
    }
    const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: bed.prompt, music_length_ms: SECONDS * 1000 }),
    })
    if (!r.ok) throw new Error(`${bed.id}: ${r.status} ${await r.text()}`)
    const raw = join(OUT, `${bed.id}.raw.mp3`)
    await writeFile(raw, Buffer.from(await r.arrayBuffer()))
    // thin the low end for the narrator, even out the level, fade both ends, keep it stereo
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', raw,
      '-af', `highpass=f=110,lowshelf=f=220:g=-4,loudnorm=I=-23:TP=-3:LRA=7,afade=t=in:d=2.5,afade=t=out:st=${SECONDS - 5}:d=5`,
      '-ar', '44100', '-b:a', '104k', file,
    ])
    await unlink(raw)
    console.log(`wrote ${bed.id}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
