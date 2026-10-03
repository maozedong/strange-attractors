/**
 * Narration scripts, one per chapter id, written for the ear rather than the eye: numbers
 * spelled out, sentences shorter, ellipses where the voice should breathe. Generated once
 * into public/audio/vo-<id>.mp3 by `pnpm audio`.
 */
export const NARRATION: Record<string, string> = {
  rounding:
    'Winter, nineteen sixty-one. Edward Lorenz, a meteorologist at MIT, wanted another look at part of a weather simulation. To save time, he restarted it halfway through, typing the numbers in from a printout. The printout said zero point five zero six. The computer had been holding zero point five zero six, one two seven. The new run shadowed the old one for a while… then drifted into completely different weather. A difference of one part in ten thousand had not stayed small. It had grown, until it was the forecast. The path drawing itself here is the toy he distilled from that afternoon: three equations for warm air rising through a cold layer. It never repeats. And it never stops.',
  twins:
    "Two copies of the same system, started one millionth of a unit apart. Far closer than Lorenz's rounding error. Far closer than any thermometer can measure. They track each other so exactly that you see a single path. Then, on some lap, they choose different wings… and from that moment on, they have nothing in common. The gap between them doesn't creep. It doubles, and doubles again, about every zero point seven seven units of time. Make the nudge a thousand times smaller, and you buy only eight more units of agreement. That arithmetic is the butterfly effect. It is why weather forecasts go blind after about two weeks, however good the computers get.",
  swarm:
    'Now take a quarter of a million starting points, and pack them into a ball a thousandth of a unit across. Smaller than a pixel. Each one is painted by where it sits in the ball. Release them. The ball stretches into a thread. The thread folds over on itself. The fold stretches again… like taffy on a pulling machine. Within a few dozen units of time, the colours are scrambled across the whole shape. Points that began as neighbours end up anywhere at all. Nothing random is happening. Stretching and folding simply erase the information in your starting point, a little at a time, until none is left.',
  shape:
    'Here is the twist. However wildly a path wanders, it never leaves this butterfly. Start anywhere nearby, and you are pulled onto it. Once on it, you circle forever. A shape that pulls paths in is called an attractor. This one is strange: it is made of infinitely many sheets, stacked like filo pastry, so that its dimension comes out at about two point zero six. More than a surface. Less than a solid. The two eyes of the butterfly are places where the fluid could sit perfectly still. It never does. At these settings the eyes push paths away, and every path spirals out of them. And no two paths ever cross. The equations allow exactly one future per point.',
  heat:
    "Lorenz's equations describe a layer of fluid warmed from below. The dial, rho, is how hard you warm it. Cold, nothing moves, and every path dies at the centre. Warm it a little, and the fluid settles into one of two steady rolls: the eyes. Past rho of about twenty-four point seven, the rolls lose their grip, and the butterfly appears. Keep going, and you find windows of perfect, repeating order, hiding inside the chaos. One number, turned slowly, takes the same three equations from stillness to chaos and back. There is no switch anywhere that says chaos.",
  zoo: "Lorenz's butterfly was only the first. Once people knew what to look for, strange attractors turned up in chemistry, in electronics, in lasers… and in equations invented purely to see what would happen. Pick one. The swarm flows from the shape it is on into the new one.",
  tap:
    'Here is a tap, dripping. Turn it up a little, and the drips come faster… but still evenly spaced. One rhythm. Turn it up a little more, and the rhythm splits: a long gap, then a short one. Long, short, long, short. Turn again: four gaps, repeating. Then eight. Then sixteen. The splits come faster and faster… until there is no rhythm at all. Every gap is different, and it never settles. This is the logistic map, the simplest equation that can do this. Each drip depends on the last by one rule: the next x is r times x times one minus x. In nineteen seventy-six, Robert May asked that every student be taught it, so that nobody would ever again assume that simple rules mean simple behaviour. Now lay every rhythm out against the dial, and you get this: the bifurcation diagram. One line, splitting into two, into four, into a cloud… and inside the cloud, windows where the rhythm comes back.',
  feigenbaum:
    'Look at where the splits happen. The first at r equals three. The next at three point four four nine. Then three point five four four, then three point five six four. Each gap is shorter than the last by the same factor… four point six six nine. Mitchell Feigenbaum found that number in nineteen seventy-five, on a pocket calculator, and could not believe it. Then it turned up in a dripping tap. In an electronic circuit. In a convecting fluid. In the Lorenz equations themselves. The same four point six six nine, every time, in systems that share nothing but the shape of a hump. There is, it seems, only one way to go from order to chaos by doubling, and it has a number.',
  shadow:
    'Now a different equation, from a different world: complex numbers, two dimensions. z becomes z squared, plus c. Colour each point c by how fast it escapes to infinity, and you get the most famous picture in mathematics: the Mandelbrot set. Benoit Mandelbrot first printed it in nineteen eighty, on a line printer. Here is the thing nobody tells you. Lay the bifurcation diagram along the axis of symmetry… and they line up. The big cardioid is the steady drip. The circle beside it is the split into two. The next bulb is four, and so on, down to the tip. The logistic map is the Mandelbrot set, seen edge on. And along that line, deep inside the chaos, where the rhythm came back… there is a tiny, perfect copy of the whole set. Zoom in further, and there is another one inside that.',
  julia:
    "Every point in that picture has a shape of its own. Pick a c, and ask instead which starting points stay bounded. That is the Julia set of c. Inside the Mandelbrot set, the Julia set is one connected piece. Step outside, and it shatters into dust. Watch it change as the point drifts along the edge: spirals, dendrites, rabbits, seahorses. Gaston Julia worked all of this out in nineteen eighteen, recovering from a war wound, without ever seeing a single picture of it. Now drag the point yourself.",
  roll:
    "Here is a game. Three corners of a triangle, and a dot anywhere you like. Roll a die. One or two: move halfway to the first corner. Three or four: halfway to the second. Five or six: the third. Mark where you land, and roll again. Nothing could be more random… and yet, after a few dozen rolls, every point lands on this: Sierpinski's triangle, with holes at every scale. Now change the rules. Four moves instead of three, each a squeeze and a turn, chosen with different odds. The same random game now draws… a fern. Michael Barnsley found those four moves in nineteen eighty-eight: twenty-eight numbers, and out comes a plant. The randomness isn't drawing the fern. It is only exploring it. The fern is the attractor of the rules, exactly as the butterfly was the attractor of Lorenz's equations. Nudge one number, and you get a different species.",
  coast:
    "How long is the coastline of Britain? Walk it with a two-hundred-kilometre ruler, and you get about two thousand two hundred kilometres. Use a hundred-kilometre ruler: two thousand eight hundred. Fifty: three thousand seven hundred. The shorter the ruler, the more bays and headlands it finds, and the answer never settles. Lewis Fry Richardson noticed this in the nineteen-fifties, and nobody cared. Benoit Mandelbrot read it in nineteen sixty-seven and realised the coast has a dimension of its own. Not one, like a line. Not two, like a map. Somewhere around one point two five: this coast measures one point three. The same trick works on the butterfly. Cover it with boxes, count the ones it touches, shrink the boxes and count again. The count grows faster than it would for a sheet, and slower than for a solid. Take the boxes all the way down and the butterfly comes out at two point zero six dimensional. That number is what strange means.",
  bulb:
    'For eighty years, fractals lived on paper. Flat. People tried to lift the Mandelbrot set into three dimensions, and got nothing worth looking at. Then, in two thousand and nine, Daniel White and Paul Nylander tried a different trick: raise a point to a power not by multiplying, but by spinning it, through two angles at once, the way you would on a globe. Power two gives a lumpy sphere. Power eight gives this. The Mandelbulb. Nobody designed it, and there is no file for it. It is computed fresh for every pixel, by firing a ray and asking the equation, over and over, how far it is to the surface. Turn it. Every bud has buds, and those have buds, as far down as you care to go.',
  cat:
    'Take a picture. Stretch it, shear it, and wrap whatever spills over the edge back round to the other side. Do it again. After a few steps the picture is noise: every pixel scattered, no trace of a cat. Keep going. Nothing changes, step after step after step… and then, suddenly, there she is. Exact. Every pixel back where it started. Vladimir Arnold used this map in the nineteen sixties to show what mixing really is. No information was ever lost. It was only moved, and since there are only so many pixels, the moves must eventually repeat. Chaos is deterministic. It just has a very good memory for things we cannot keep track of. Try it with your own face.',
  pendulums:
    "A pendulum is the most predictable thing in physics. Hang a second pendulum from the end of the first, and you get one of the least. Here are a hundred of them, released together, each one differing from its neighbour by a millionth of a degree. For a few swings they move as one. Then the fan opens… and within a few swings they are doing a hundred different things. No two will ever agree again. There is nothing special in the equations: two rods, two weights, gravity. The sensitivity is the whole story. You cannot build this in the real world and have it do the same thing twice, because you cannot set it up the same way twice. Not to a millionth of a degree. Not to a trillionth.",
  forecast:
    "This is why the weather forecast comes with percentages. In nineteen ninety-two, the European forecasting centre stopped running its model once. It now runs fifty-one copies, each started from a slightly different guess at today's atmosphere, because today's atmosphere is never known exactly. Here is a toy version, a model Lorenz built in nineteen ninety-six: forty weather stations around a ring. Watch the fifty copies. Day one, they agree. Day three, they fray. By day ten the fan is as wide as the weather itself, and the forecast has nothing left to say. The spread is the forecast. When the copies agree, trust it. When they scatter, take the umbrella anyway. And there is a wall, somewhere around two weeks, that no computer will ever get past… because the doubling never stops.",
  voice:
    "Chaos doesn't only live in equations. Listen. The sound of a voice, drawn as a wave, is a jittery scribble. But take that wave, and plot it against itself a few milliseconds ago… and again a few milliseconds before that… and the scribble unfolds into a shape in three dimensions. This is Takens's trick, from nineteen eighty-one. You do not need to measure everything about a system. One signal, delayed against itself, rebuilds the shape of the whole thing. A steady vowel is a loop. A rougher sound is a tangle. The attractor you are looking at now… is my voice. Try yours.",
  hyperion:
    "Saturn has a moon shaped like a potato. Hyperion: three hundred and sixty kilometres long, and the only known body in the solar system that tumbles chaotically. Every other moon spins neatly. Hyperion lurches. Its orbit is slightly stretched, so Saturn's pull on that lumpy shape changes on every pass, and the kicks never quite repeat. Jack Wisdom predicted this in nineteen eighty-four, before any spacecraft had a good look. Here are two Hyperions, started a tenth of a degree apart. Count the orbits. Within a few months they are facing different ways… and nobody can say which face of the real Hyperion will point at Saturn a year from now. Not because we lack the data. Because the data cannot be had.",
  hold:
    "Chaos can be useful. A taffy puller is a chaos machine: three rods, turning, stretching the sugar and folding it back, thousands of times an hour, because stretch-and-fold is the fastest way to mix anything. The same geometry kneads bread, and mixes chemicals on a chip. In an office in San Francisco, a wall of a hundred lava lamps is photographed over and over, and the unpredictable wobble of the wax becomes the random numbers that lock a large slice of the internet. And in the nineteen nineties, physicists learned to tame it. With tiny, well-timed nudges, a chaotic laser, a fibrillating heart, even the butterfly, can be held on any of the loops hidden inside it. The thing that makes chaos unpredictable is the thing that makes it controllable. A small push goes a long way.",
  murmuration:
    "Ten thousand starlings, and no leader. Three rules: don't crowd your neighbours; fly the way they fly; stay close to them. That is all. Craig Reynolds wrote those rules down in nineteen eighty-six to animate birds for films, and the flock that appeared behaved like a real one: it splits round a hawk and heals, it turns as a wave, it never collides. Nobody is in charge. The shape of the flock has no address in any bird. Order of this kind is called emergence, and it is the mirror image of chaos. There, simple rules make motion nobody can predict. Here, simple rules make a thing that looks designed.",
  turing:
    "In nineteen fifty-two, two years before he died, Alan Turing asked how the leopard gets its spots. His answer: two chemicals spreading through the skin at different speeds, one making more of itself, the other killing it off. Where the slow one wins, a spot. Where it loses, bare skin. Start them off perfectly uniform, with the smallest flicker of noise, and the pattern invents itself. Now turn two dials, and watch. The labyrinth straightens into stripes. Push a little further, and the stripes break into cells that divide, and divide again. Further still, and the dividing settles into spots. The leopard's spots and the zebra's stripes are the same equation with the dial in a different place. It took nearly forty years before anyone saw it happen in a dish.",
  lenia:
    "Conway's Game of Life ran on a grid of squares, each alive or dead. In twenty nineteen, Bert Chan asked what happens if you make it smooth: cells that are a little bit alive, neighbourhoods shaped like rings, time that flows instead of ticking. He called it Lenia. And something nobody designed showed up. Creatures. They swim. They keep their shape. Push one and it recovers; squeeze it and it splits in two. There are hundreds of species now, catalogued like beetles, and not one of them was drawn by anybody. They are solutions. The rule found them.",
  fireflies:
    "On the riverbanks of Thailand, whole trees of fireflies flash together. Each one only sees its neighbours, and nudges its own timing a little toward theirs. From that, within minutes, the entire tree blinks as one. Yoshiki Kuramoto wrote down the equation in nineteen seventy-five: a crowd of oscillators, each pulling the others into step. Below a certain coupling they ignore each other, and the flashing is noise. Above it, they lock. Not all at once: a core forms and grows, and the stragglers fall in. The pacemaker cells in your heart do this. So did the Millennium Bridge in London on its opening day, when a thousand footsteps fell into step and the whole bridge began to sway. This is the opposite of the butterfly effect… and it comes from the same kind of equation.",
  sandpile:
    "Drop sand, one grain at a time, onto a pile. Mostly, nothing happens. Now and then a grain tips its neighbour, which tips its neighbours… and an avalanche runs down the whole slope. Per Bak, Chao Tang and Kurt Wiesenfeld built this toy in nineteen eighty-seven, and found that the avalanches have no typical size. Small ones are common, enormous ones are rare, and the rule connecting them is the same rule that connects small earthquakes to great ones. The pile organises itself to the edge of collapse, and stays there. Nobody tunes it. And if you pour every grain onto the same spot, with perfect patience, starting from nothing, the pile settles into… this. A fractal, hiding in a heap of sand.",
  everywhere:
    'Dripping taps. Double pendulums. A heart in fibrillation. The storms of Jupiter. The orbits of the inner planets, which forget where they were after about five million years. None of it is random… and all of it is this. The lesson Lorenz left is not that the world is unknowable. It is that determinism and prediction are different things, and that the gap between them has a precise, and rather beautiful, shape.',
}

/** Order used for request stitching, so each chapter's delivery follows on from the last. */
export const NARRATION_ORDER = [
  'rounding',
  'twins',
  'swarm',
  'shape',
  'heat',
  'zoo',
  'everywhere',
  'tap',
  'feigenbaum',
  'shadow',
  'julia',
  'roll',
  'coast',
  'bulb',
  'cat',
  'pendulums',
  'forecast',
  'voice',
  'hyperion',
  'hold',
  'murmuration',
  'turing',
  'lenia',
  'fireflies',
  'sandpile',
]

export interface SfxSpec {
  /** file stem: public/audio/sfx-<id>.mp3 */
  id: string
  prompt: string
  seconds: number
  loop?: boolean
}

export const SFX: SfxSpec[] = [
  {
    id: 'ambient',
    prompt:
      'Deep, slow, airy space drone. Dark, soft, cinematic, very subtle shimmering overtones, no melody, no rhythm, seamless loop.',
    seconds: 14,
    loop: true,
  },
  {
    id: 'release',
    prompt: 'A deep, soft cinematic whoosh with fine sparkling particles dispersing outward, airy, 3 seconds.',
    seconds: 3,
  },
  {
    id: 'turn',
    prompt: 'A single very soft, short, low glass tap, subtle, minimal user interface sound.',
    seconds: 0.8,
  },
  {
    id: 'shimmer',
    prompt: 'A soft rising shimmer of glass and air, gentle, ethereal, quick, 2 seconds.',
    seconds: 2,
  },
  {
    id: 'split',
    prompt: 'A subtle crystalline ping that bends slightly upward in pitch, soft, clean, 1.5 seconds.',
    seconds: 1.5,
  },
  {
    id: 'drip',
    prompt: 'A single clean water drop falling into a still pool, close, soft, with a short bright plink and no reverb tail.',
    seconds: 0.7,
  },
  {
    id: 'rise',
    prompt: 'A soft, slow, airy swell rising in pitch, cinematic reveal, glassy, 4 seconds.',
    seconds: 4,
  },
]
