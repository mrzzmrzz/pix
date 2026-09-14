import { visibleWidth } from '@earendil-works/pi-tui'

import { bandTouches, cycleLength, glimmerAt, inBand } from './shimmer.js'

/**
 * Faces padded to the width of the widest one.
 *
 * Kaomoji run from five to seven columns, and an unpadded set would shove the
 * verb sideways every time the face changed.
 */
export function padFaces(faces: readonly string[]): string[] {
  const width = faces.reduce((max, face) => Math.max(max, visibleWidth(face)), 1)

  return faces.map(face => face + ' '.repeat(Math.max(0, width - visibleWidth(face))))
}

export interface FrameOptions {
  /** The lighter tint the band is drawn in. */
  band: (char: string) => string
  /** The colour the rest of the run keeps. */
  base: (char: string) => string
  faces: readonly string[]
  /** The turn's activity verb; the ellipsis is added here. */
  verb: string
}

/**
 * The whole animation, as one frame list.
 *
 * Pi owns the working row: it renders an indicator frame followed by a message
 * it paints muted itself. So both halves of the Harness line that shimmer — the
 * face and the verb — have to travel in the frames, and only the elapsed clock
 * is left for the message.
 *
 * One frame is one shimmer tick, and one cycle of the sweep is one face. At
 * 100 ms a cycle runs three to five seconds, which is the pace the faces changed
 * at before; no second timer is needed to move them.
 */
export function buildFrames({ band, base, faces, verb }: FrameOptions): string[] {
  const frames: string[] = []

  for (const face of padFaces(faces)) {
    const chars = [...`${face} ${verb}…`]
    // Most of a cycle has the band off the run, and every one of those frames is
    // the same picture. Painting it once and sharing the string keeps a list of
    // a thousand frames small.
    const resting = chars.map(base).join('')

    for (let tick = 0; tick < cycleLength(chars.length); tick++) {
      const glimmer = glimmerAt(tick, chars.length)

      frames.push(
        bandTouches(glimmer, chars.length)
          ? chars.map((char, index) => (inBand(index, glimmer) ? band(char) : base(char))).join('')
          : resting
      )
    }
  }

  return frames
}
