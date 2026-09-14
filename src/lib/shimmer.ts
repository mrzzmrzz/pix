/**
 * The shimmer the OpenDDE Harness draws across its working row, as Claude Code
 * draws it: a band of {@link SHIMMER_BAND} characters in a lighter tint sweeps
 * the face and the verb, one character every {@link SHIMMER_MS}. The sweep
 * starts {@link SHIMMER_LEAD} characters before the run and ends as far past it,
 * so for most of each cycle the band is off the text and the line rests. That
 * pause, not the step, is what makes it read as gentle.
 */
export const SHIMMER_MS = 100
export const SHIMMER_BAND = 3
export const SHIMMER_LEAD = 10

/** Characters either side of the band's centre. */
const HALF_BAND = (SHIMMER_BAND - 1) / 2

/** Ticks in one full sweep of a run of `length` characters. */
export function cycleLength(length: number): number {
  return Math.max(1, length + 2 * SHIMMER_LEAD)
}

/** Which character the band is centred on at `tick`, over a run of `length`
 *  characters: from {@link SHIMMER_LEAD} before the run to as far past it. */
export function glimmerAt(tick: number, length: number): number {
  return (tick % cycleLength(length)) - SHIMMER_LEAD
}

/** Whether character `index` lies in the band centred on `glimmer`. */
export function inBand(index: number, glimmer: number): boolean {
  return Math.abs(index - glimmer) <= HALF_BAND
}

/** Whether the band touches a run of `length` characters at all. Off the run,
 *  every frame of the sweep is the same picture, and one string can serve them
 *  all. */
export function bandTouches(glimmer: number, length: number): boolean {
  return glimmer + HALF_BAND >= 0 && glimmer - HALF_BAND < length
}

/** `45s`, `2m 05s`, `1h 12m`. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`
}
