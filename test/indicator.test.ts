import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { expect, it } from 'vitest'

import { FACES } from '../src/lib/faces.js'
import { buildFrames, padFaces } from '../src/lib/frames.js'
import { bandTouches, cycleLength, formatElapsed, glimmerAt, inBand } from '../src/lib/shimmer.js'
import { VERBS } from '../src/lib/verbs.js'

const VERB = 'reading the diff'
/** Paints that leave the visible text alone, so a frame can be read back. */
const base = (char: string) => `\x1b[35m${char}\x1b[39m`
const band = (char: string) => `\x1b[1m${char}\x1b[22m`

const runOf = (face: string) => `${face} ${VERB}…`

it.each([
  [0, '0s'],
  [45, '45s'],
  [125, '2m 05s'],
  [600, '10m 00s'],
  [4320, '1h 12m']
])('formats %d seconds as %s', (seconds, expected) => {
  expect(formatElapsed(seconds)).toBe(expected)
})

it('sweeps the band across every character exactly once per cycle', () => {
  const length = 12
  const centres = Array.from({ length: cycleLength(length) }, (_, tick) => glimmerAt(tick, length))

  for (let index = 0; index < length; index++) {
    expect(centres.filter(centre => centre === index)).toEqual([index])
    expect(centres.some(centre => inBand(index, centre))).toBe(true)
  }

  // The rest of the cycle is the pause that makes the sweep read as gentle.
  expect(centres.filter(centre => bandTouches(centre, length))).toHaveLength(length + 2)
})

it('pads every face to the width of the widest', () => {
  const padded = padFaces(FACES)

  expect(new Set(padded.map(visibleWidth))).toEqual(new Set([7]))
  expect(padded.map((face, index) => face.startsWith(FACES[index]!))).not.toContain(false)
})

it('carries a face and the verb in every frame', () => {
  const padded = padFaces(FACES)
  const frames = buildFrames({ band, base, faces: FACES, verb: VERB })

  // One cycle per face, and a face's own character count sets its cycle: the
  // kaomoji with combining accents are narrower than they are long.
  expect(frames.map(stripTerminalSequences)).toEqual(
    padded.flatMap(face => Array.from({ length: cycleLength([...runOf(face)].length) }, () => runOf(face)))
  )
})

it('paints a distinct frame for every step the band is on the run', () => {
  const face = FACES[0]!
  const length = [...runOf(padFaces([face])[0]!)].length
  const frames = buildFrames({ band, base, faces: [face], verb: VERB })

  // The band touches the run at length + 2 offsets; every other tick of the
  // cycle is the one resting picture.
  expect(new Set(frames).size).toBe(length + 3)
})

it('offers verbs that are unique and start lower-case', () => {
  expect(new Set(VERBS).size).toBe(VERBS.length)
  // Acronyms keep their capitals; nothing else opens with one.
  expect(VERBS.filter(verb => verb[0] !== verb[0]!.toLowerCase())).toEqual([])
})
