/**
 * The screenplay: every word the narrator says, in order, and nothing else. Scenes (src/scenes)
 * hang their pictures on these lines; the recording script (scripts/narrate.ts) turns them into
 * audio and word timings. No three.js in this file: it is also read by Node.
 *
 * A line is one caption. `say` is how the line is read aloud when digits or symbols would trip
 * the voice. A gate is a moment the film hands to the visitor: it waits `timeout` seconds for the
 * gesture, then performs it itself, so the film never stalls.
 */
export type Act = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Line {
  text: string
  say?: string
}

export interface Gate {
  gate: string
  /** what to do, in the visitor's words */
  prompt: string
  timeout: number
}

export interface SceneScript {
  id: string
  act: Act
  title: string
  lines: (string | Line | Gate)[]
  /** seconds the picture holds after the last word */
  outro?: number
}

export interface ActInfo {
  act: Act
  numeral: string
  title: string
  tagline: string
}

export const ACTS: ActInfo[] = [
  { act: 0, numeral: '', title: 'A rounding error', tagline: 'Winter, 1961.' },
  { act: 1, numeral: 'I', title: 'The butterfly', tagline: 'Why the future will not hold still.' },
  { act: 2, numeral: 'II', title: 'Order inside chaos', tagline: 'A dripping tap, one number, and the most famous picture in mathematics.' },
  { act: 3, numeral: 'III', title: 'Fractals in the flesh', tagline: 'A fern from dice, a coast that never adds up, a cat that comes back.' },
  { act: 4, numeral: 'IV', title: 'Chaos in the world', tagline: 'Pendulums, forecasts, a tumbling moon, and chaos put to work.' },
  { act: 5, numeral: 'V', title: 'Order from nothing', tagline: 'Starlings, spots, creatures nobody drew, and a heap of sand.' },
  { act: 6, numeral: '', title: 'The shape of not knowing', tagline: '' },
]

const gate = (name: string, prompt: string, timeout = 7): Gate => ({ gate: name, prompt, timeout })

export const SCREENPLAY: SceneScript[] = [
  // ───────────────────────────── Prologue ─────────────────────────────
  {
    id: 'rounding',
    act: 0,
    title: 'A rounding error',
    lines: [
      { text: 'Winter, 1961. In an office at MIT, a computer the size of a desk is making weather.', say: 'Winter, nineteen sixty-one. In an office at M.I.T., a computer the size of a desk is making weather.' },
      'Not real weather. A dozen equations, a toy sky, printed out one line at a time.',
      'Edward Lorenz wants to see one stretch of it again.',
      'So he types the numbers back in from the printout, and goes for coffee.',
      { text: 'The machine had been holding 0.506127.', say: 'The machine had been holding zero point five zero six, one two seven.' },
      { text: 'The printout only had room for 0.506.', say: 'The printout only had room for zero point five zero six.' },
      gate('round', 'Click to round it off, the way Lorenz did', 8),
      'A difference of barely a ten-thousandth.',
      'For a while, the new weather shadows the old.',
      'Then it wanders off. Two months on, the two skies have nothing in common.',
      'Nothing was broken. That ten-thousandth had grown until it was the whole forecast.',
      'Lorenz boiled his weather down to three equations. Drawn in space, they look like this.',
      'A path that never repeats. And never leaves.',
    ],
    outro: 3.5,
  },

  // ───────────────────────────── Act I: The butterfly ─────────────────────────────
  {
    id: 'twins',
    act: 1,
    title: 'Twins',
    lines: [
      'Run that accident again, on purpose.',
      'Two copies of the same weather, started one millionth of a unit apart.',
      'Closer than any thermometer could tell.',
      'They move as one. You are looking at two paths, and seeing one.',
      'Then, on some lap, they choose different wings.',
      'From here on, they have nothing to do with each other.',
      "The gap between them doesn't creep. It doubles. Then it doubles again.",
      'So start them a thousand times closer.',
      'It buys you a few more laps. No more.',
      'This is the butterfly effect. It is why no forecast, on any computer, sees much past two weeks.',
    ],
    outro: 3,
  },
  {
    id: 'swarm',
    act: 1,
    title: 'The swarm',
    lines: [
      'Two paths are a hint. Here is the whole picture.',
      'A quarter of a million starting points, packed into a ball smaller than this dot.',
      'Each one coloured by where it sits inside.',
      gate('release', 'Click to let them go', 7),
      'The ball stretches into a thread.',
      'The thread folds over on itself. And the fold stretches again.',
      'Like taffy on a pulling machine.',
      'Watch the colours. Neighbours at the start are strangers now.',
      'Nothing here is random. Every point obeys the same three equations.',
      'Stretching and folding simply wear the starting point away, until nothing of it is left.',
    ],
    outro: 3,
  },
  {
    id: 'shape',
    act: 1,
    title: "The shape it can't leave",
    lines: [
      'And yet. Look at what all that wandering has drawn.',
      'No path, however wild, ever leaves this shape.',
      'Start anywhere nearby, and you are pulled onto it.',
      'A shape that pulls everything in is called an attractor.',
      "This one is strange. It isn't a surface, and it isn't a solid.",
      'It is endlessly many sheets, pressed together like the layers of a pastry.',
      { text: 'Its dimension is about 2.06.', say: 'Its dimension is about two point oh six.' },
      'The two eyes are where the air could sit perfectly still. It never does.',
      "And no two paths ever cross. One point, one future. You just can't tell which point you are on.",
    ],
    outro: 3,
  },
  {
    id: 'heat',
    act: 1,
    title: 'Turn up the heat',
    lines: [
      'These equations describe a layer of air, warmed from below.',
      'One dial sets how hard you warm it.',
      'Cold, nothing moves. Every path dies at the centre.',
      'Warmer, and the air turns over in a steady roll. One of two: the eyes.',
      'Then, a little past twenty-four, the rolls lose their grip.',
      'Chaos. Nothing was added. The dial just moved.',
      'Keep turning, and inside the chaos you find windows of perfect order.',
      'The same three equations, from stillness to chaos and back.',
      'There is no switch anywhere marked chaos.',
    ],
    outro: 3,
  },
  {
    id: 'zoo',
    act: 1,
    title: 'The zoo',
    lines: [
      "Lorenz's butterfly was the first. Once people knew what to look for, they found them everywhere.",
      "In a chemist's sketch of the simplest chaos he could imagine.",
      'In an electronic circuit you can build for a few dollars.',
      'In a loop of feedback, drawn by a biologist.',
      'In equations written down only to see what they would do.',
      'Different equations. Different shapes. The same behaviour underneath.',
      'And it was never only on paper. A heartbeat losing its rhythm. The orbits of the planets. A dripping tap.',
      'Start with the tap.',
    ],
    outro: 2.5,
  },

  // ───────────────────────────── Act II: Order inside chaos ─────────────────────────────
  {
    id: 'tap',
    act: 2,
    title: 'The dripping tap',
    lines: [
      'A tap, dripping. Slow, and even.',
      'Open it a little, and the drips come faster. Still one rhythm.',
      'A little more, and the rhythm splits. Long gap, short gap. Long, short.',
      'Again. Four gaps, repeating. Then eight. Then sixteen.',
      'The splits come faster and faster, until there is no rhythm left at all.',
      'One line of arithmetic does all of this. Each drip sets up the next.',
      'Now lay every rhythm side by side, one for each position of the tap.',
      'One line. Two. Four. Then a cloud.',
      'And inside the cloud, narrow windows where the rhythm comes back.',
    ],
    outro: 3,
  },
  {
    id: 'feigenbaum',
    act: 2,
    title: 'The same number, everywhere',
    lines: [
      'Look at where the forks are.',
      'Each stretch between them is shorter than the one before.',
      { text: 'Shorter by the same factor, every time: 4.669.', say: 'Shorter by the same factor, every time: four point six six nine.' },
      { text: 'Mitchell Feigenbaum found it in 1975, on a pocket calculator.', say: 'Mitchell Feigenbaum found it in nineteen seventy-five, on a pocket calculator.' },
      'Then he tried a different equation, and got the same number.',
      'It has since turned up in dripping taps. In electronic circuits. In liquid helium, heated from below.',
      'Systems with nothing in common, falling into chaos at exactly the same rate.',
      'It is a constant of nature, like pi. And nobody knew it was there.',
    ],
    outro: 3,
  },
  {
    id: 'shadow',
    act: 2,
    title: 'The shadow of the Mandelbrot set',
    lines: [
      'A different equation, from a different world.',
      'Take a number. Square it. Add a constant. Repeat.',
      'Colour every constant by what happens next, and you get the most famous picture in mathematics.',
      'Now stand the last diagram up along its axis.',
      'They line up. The heart-shaped body is the steady drip.',
      'The disc beside it, the split into two. The next bud, four.',
      'The dripping tap was the Mandelbrot set all along, seen edge on.',
      'And out along that line, where the rhythm came back, there is a tiny copy of the whole set.',
      'Go closer. There is another one inside it.',
    ],
    outro: 4,
  },
  {
    id: 'julia',
    act: 2,
    title: 'A fractal in every point',
    lines: [
      'Every point of that picture is hiding a picture of its own.',
      'Choose a point, and it gives you a shape: its Julia set.',
      'Inside the Mandelbrot set, the shape holds together in one piece.',
      'Step over the edge, and it shatters into dust.',
      'Walk along the border, and it never stops changing. Spirals. Lightning. Seahorses.',
      { text: 'Gaston Julia worked all of this out in 1918, in a hospital bed, with pencil and paper.', say: 'Gaston Julia worked all of this out in nineteen eighteen, in a hospital bed, with pencil and paper.' },
      'He never saw a single one.',
    ],
    outro: 5,
  },

  // ───────────────────────────── Act III: Fractals in the flesh ─────────────────────────────
  {
    id: 'roll',
    act: 3,
    title: 'Roll the dice',
    lines: [
      'A game. Three corners, and a dot placed anywhere.',
      'Roll a die, and move the dot halfway to whichever corner comes up.',
      'Mark the spot. Roll again.',
      'Nothing could be more random. So keep rolling.',
      'A triangle full of holes, with smaller triangles in every corner, all the way down.',
      'Now change the moves. Four of them, each a squeeze and a turn.',
      'The same blind dice draw a fern.',
      "The dice aren't making the fern. They are only finding it.",
      "It was already there in the rules, the way the butterfly was already there in Lorenz's equations.",
    ],
    outro: 3,
  },
  {
    id: 'coast',
    act: 3,
    title: 'How long is the coast of Britain?',
    lines: [
      'How long is the coast of Britain?',
      { text: 'Walk it with a ruler 200 kilometres long, and you get about 2,200 kilometres.', say: 'Walk it with a ruler two hundred kilometres long, and you get about two thousand two hundred kilometres.' },
      { text: 'Halve the ruler: 2,800.', say: 'Halve the ruler: two thousand eight hundred.' },
      { text: 'Halve it again: 3,700.', say: 'Halve it again: three thousand seven hundred.' },
      'A shorter ruler finds more bays, more headlands. The answer never settles.',
      'A coastline is more than a line, and less than a surface. Its dimension is about one and a quarter.',
      'The butterfly can be measured the same way. Cover it in boxes, and count.',
      'Shrink the boxes. Count again.',
      { text: 'More than a sheet. Less than a solid. 2.06.', say: 'More than a sheet. Less than a solid. Two point oh six.' },
      'That number is what strange means.',
    ],
    outro: 3,
  },
  {
    id: 'bulb',
    act: 3,
    title: 'A fractal with a body',
    lines: [
      'For eighty years, fractals lived flat on the page.',
      'Every attempt to give the Mandelbrot set a body came out smooth and dull.',
      { text: 'Then, in 2009, two hobbyists on an internet forum tried turning a point instead of multiplying it.', say: 'Then, in two thousand and nine, two hobbyists on an internet forum tried turning a point instead of multiplying it.' },
      'Raise the power.',
      'This is the Mandelbulb.',
      'Nobody sculpted it. There is no model, and no file.',
      'Every pixel asks the equation one question: how far to the surface?',
      'Go closer. Every bud has buds.',
      'And those have buds. It never runs out.',
    ],
    outro: 4,
  },
  {
    id: 'cat',
    act: 3,
    title: "Arnold's cat",
    lines: [
      'Take a picture. Stretch it, shear it, and fold whatever spills over back inside.',
      'Do it again.',
      'A few more times, and the cat is gone. Every pixel scattered.',
      'This is what mixing means. Keep going, and nothing seems to change.',
      'Noise. And more noise.',
      'And then… there she is.',
      'Every pixel, back where it began.',
      "Nothing was ever lost. It was only moved, somewhere we couldn't follow.",
      "Chaos doesn't destroy information. It hides it, in plain sight.",
    ],
    outro: 3,
  },

  // ───────────────────────────── Act IV: Chaos in the world ─────────────────────────────
  {
    id: 'pendulums',
    act: 4,
    title: 'A hundred pendulums',
    lines: [
      'A pendulum is the most predictable thing in physics.',
      'Hang a second one from the end of the first.',
      'Here are a hundred of them, let go together.',
      'Each differs from the next by a millionth of a degree.',
      'For a few swings, they move as one.',
      'Then the fan opens.',
      'A hundred pendulums. A hundred different futures.',
      'Two rods, two weights, and gravity. Nothing else.',
      'You could never build this and watch it do the same thing twice.',
    ],
    outro: 3,
  },
  {
    id: 'forecast',
    act: 4,
    title: 'Why forecasts come in bulk',
    lines: [
      'This is why a forecast comes with a percentage.',
      'Nobody knows exactly what the sky is doing right now.',
      "So the weather centres don't run tomorrow once. They run it fifty times, from fifty slightly different todays.",
      'Here are fifty copies of a small model of the wind around the world.',
      'Day one. They agree.',
      'Day three. They fray.',
      'By day ten, they are as far apart as weather can be.',
      'When the copies agree, trust the forecast. When they scatter, take an umbrella.',
      'And somewhere near two weeks, there is a wall no computer will ever get past.',
    ],
    outro: 3,
  },
  {
    id: 'voice',
    act: 4,
    title: 'Your voice is an attractor',
    lines: [
      "Chaos isn't only in equations. You are listening to some.",
      'A voice, drawn as a wave, is a scribble.',
      'But plot that wave against itself, a moment ago. And a moment before that.',
      'The scribble opens out into a shape.',
      'A steady vowel is a loop. A rough breath is a tangle.',
      'From one wobbling line, you can rebuild the shape of the whole machine behind it.',
      'Doctors read heartbeats this way. Engineers listen to turbines.',
      'The shape on screen is my voice. Lend it yours.',
    ],
    outro: 5,
  },
  {
    id: 'hyperion',
    act: 4,
    title: 'The moon that tumbles',
    lines: [
      'Saturn has a moon shaped like a potato.',
      { text: 'Hyperion. 360 kilometres long.', say: 'Hyperion. Three hundred and sixty kilometres long.' },
      'Every other large moon keeps one face to its planet. This one tumbles.',
      "Its orbit is a little stretched, so Saturn's pull tugs at it differently on every pass.",
      'Here are two Hyperions, set spinning a tenth of a degree apart.',
      'Give them a few months.',
      'Nobody can say which way the real one will be facing a year from now.',
      "Not because we haven't measured it well enough.",
      'Because no measurement could ever be good enough.',
    ],
    outro: 3,
  },
  {
    id: 'hold',
    act: 4,
    title: 'Chaos, put to work',
    lines: [
      'Chaos has its uses.',
      'A taffy puller is a chaos machine. Stretch, fold. Stretch, fold.',
      'Nothing mixes faster. The same motion kneads bread, and blends chemicals on a chip.',
      'In an office in San Francisco, a camera watches a wall of lava lamps.',
      'The wobble of the wax becomes the random numbers that keep a slice of the internet secret.',
      'And chaos can be steered.',
      'Because it is so sensitive, the smallest nudge, timed well, will hold it on a single loop.',
      'Lasers are tamed this way. Spacecraft use it to cross the solar system on a sip of fuel.',
      'What makes chaos impossible to predict is what makes it easy to steer.',
    ],
    outro: 3,
  },

  // ───────────────────────────── Act V: Order from nothing ─────────────────────────────
  {
    id: 'murmuration',
    act: 5,
    title: 'Ten thousand starlings',
    lines: [
      'Now turn it all around.',
      'Ten thousand starlings. No leader, and no plan.',
      "Each bird follows three rules. Don't crowd. Fly the way your neighbours fly. Stay close.",
      'That is all there is.',
      'And the flock turns like one animal. It splits around a hawk, and heals.',
      'No bird knows the shape it is part of.',
      'This is called emergence, and it is chaos in a mirror.',
      'There, simple rules made motion nobody can predict.',
      'Here, simple rules make something that looks designed.',
    ],
    outro: 3,
  },
  {
    id: 'turing',
    act: 5,
    title: "The leopard's spots",
    lines: [
      { text: 'In 1952, Alan Turing asked how a leopard gets its spots.', say: 'In nineteen fifty-two, Alan Turing asked how a leopard gets its spots.' },
      'His answer was two chemicals, spreading through the skin at different speeds.',
      'One makes more of itself. The other shuts it down.',
      'Start them perfectly even, add the faintest flicker of noise…',
      '…and the pattern invents itself.',
      'Turn a dial, and the maze straightens into stripes.',
      'Further, and the stripes break into cells that divide. Then the cells settle into spots.',
      'The leopard and the zebra are the same equation, with the dial in a different place.',
      'It was forty years before anyone saw it happen in a dish.',
    ],
    outro: 3,
  },
  {
    id: 'lenia',
    act: 5,
    title: 'Creatures nobody drew',
    lines: [
      'The Game of Life is played on a grid. Each square is alive, or dead.',
      { text: 'In 2019, Bert Chan asked what would happen if you made it smooth.', say: 'In twenty nineteen, Bert Chan asked what would happen if you made it smooth.' },
      'Cells that are a little bit alive. Time that flows instead of ticking.',
      'And these turned up.',
      'They swim. They hold their shape. Nudge one, and it recovers.',
      'Nobody drew them. Nobody told them how to move.',
      'There are hundreds of species now, catalogued like beetles.',
      'They are not designs. They are solutions. The rule found them.',
    ],
    outro: 3.5,
  },
  {
    id: 'fireflies',
    act: 5,
    title: 'Falling into step',
    lines: [
      'On a riverbank in Thailand, a whole tree of fireflies flashes in the dark.',
      'Each one at its own pace. Noise.',
      'But every firefly watches its neighbours, and nudges its timing a little toward theirs.',
      'Turn that nudge up, slowly.',
      'A few fall into step. Then a few more.',
      'And then the whole tree is one light.',
      "The cells that pace your heart do this. So did the crowd on London's Millennium Bridge, the day it began to sway.",
      "It is the butterfly effect, run backwards. Small differences don't grow. They vanish.",
    ],
    outro: 3.5,
  },
  {
    id: 'sandpile',
    act: 5,
    title: 'The edge of collapse',
    lines: [
      'Drop sand on a table, one grain at a time.',
      'Mostly, nothing happens.',
      'Now and then a grain tips its neighbour, which tips its neighbours, and a whole slope lets go.',
      'Small slides are common. Huge ones are rare. But there is no typical size.',
      'Earthquakes follow the same rule. So do forest fires.',
      'Nobody tunes the pile. It builds itself to the edge of collapse, and stays there.',
      'And if you drop every grain on the same spot, with perfect patience…',
      '…the pile settles into this.',
      'A fractal, in a heap of sand.',
    ],
    outro: 4,
  },

  // ───────────────────────────── Epilogue ─────────────────────────────
  {
    id: 'return',
    act: 6,
    title: 'The shape of not knowing',
    lines: [
      'At the start, you rounded off a number.',
      'Those two skies are still running.',
      'They disagree about everything now. Whether it rains on Tuesday. Which way the wind blows.',
      'But look at where they both are.',
      'The same shape. They never left it, and they never will.',
      'This is what Lorenz found. Not that the world cannot be known.',
      "We can't say where on the butterfly we will be. We can say, for certain, that it will be the butterfly.",
      "The future isn't hidden from us. It just can't be hurried.",
      'The only way to learn what happens next… is to wait, and see.',
    ],
    outro: 6,
  },
]

export const isGate = (l: string | Line | Gate): l is Gate => typeof l === 'object' && 'gate' in l
export const lineText = (l: string | Line): string => (typeof l === 'string' ? l : l.text)
export const lineSay = (l: string | Line): string => (typeof l === 'string' ? l : (l.say ?? l.text))

/** A scene's lines split at its gates: one audio file per segment. */
export interface Segment {
  /** indices into the scene's spoken lines (gates excluded) */
  first: number
  lines: Line[]
  /** the gate that follows this segment, if any */
  gate?: Gate
}

export function segmentsOf(scene: SceneScript): Segment[] {
  const out: Segment[] = []
  let cur: Segment = { first: 0, lines: [] }
  let n = 0
  for (const l of scene.lines) {
    if (isGate(l)) {
      cur.gate = l
      out.push(cur)
      cur = { first: n, lines: [] }
    } else {
      cur.lines.push(typeof l === 'string' ? { text: l } : l)
      n++
    }
  }
  if (cur.lines.length > 0 || out.length === 0) out.push(cur)
  return out
}

export const sceneScript = (id: string): SceneScript => {
  const s = SCREENPLAY.find((x) => x.id === id)
  if (!s) throw new Error(`No scene '${id}' in the screenplay`)
  return s
}

/** file stem of a segment's narration: public/vo/<stem>.mp3 */
export const segmentStem = (sceneId: string, segment: number) => `${sceneId}-${segment + 1}`
