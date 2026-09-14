// What a thinking block says and how its heading catches the light. Text in,
// text out: the component that uses this is in `src/thinking.ts`.

import { wrapTextWithAnsi } from '@earendil-works/pi-tui'

import { formatElapsed, sanitizeInlineText } from './rows.js'

/** The marker in front of a finished thought. */
export const MARKER = '∴'

/** How fast the light crosses a heading. */
export const SHIMMER_MS = 90

/** Characters the shimmer lights at once: a fraction of the heading, never a
 *  single dot on a long line and never most of a short one. */
export function shimmerWidth(length: number): number {
  return Math.max(1, Math.min(5, Math.ceil(length * 0.28)))
}

/**
 * Where the lit window sits at `frame`.
 *
 * It enters from off the left and leaves off the right, so the heading rests
 * dark for a moment between passes rather than snapping back to the start.
 */
export function shimmerWindow(length: number, frame: number): { end: number; start: number } {
  const width = shimmerWidth(length)
  const start = (frame % (length + width)) - width

  return { end: start + width, start }
}

/** The heading with the window lit. `lit` and `rest` paint their halves. */
export function shimmer(
  text: string,
  frame: number,
  paint: { lit: (part: string) => string; rest: (part: string) => string }
): string {
  const characters = [...text]

  if (characters.length === 0) {
    return ''
  }

  const { end, start } = shimmerWindow(characters.length, frame)
  const before = characters.slice(0, Math.max(0, start)).join('')
  const inside = characters.slice(Math.max(0, start), Math.max(0, Math.min(characters.length, end))).join('')
  const after = characters.slice(Math.max(0, end)).join('')

  return paint.rest(before) + (inside ? paint.lit(inside) : '') + paint.rest(after)
}

/**
 * The title the model gave this thought, when it gave one.
 *
 * Reasoning summaries arrive two ways: as a bold first line in the thinking
 * text, and as summary parts in the signature some providers attach. Either is
 * a better heading than "Thinking…".
 */
/** A line that is nothing but a bold run: how a reasoning summary titles itself. */
const TITLE_LINE = /^\s*\*\*(.+?)\*\*\s*$/

export function summaryTitle(thinking: string, signature?: string): string | undefined {
  for (const line of thinking.split('\n')) {
    const bold = TITLE_LINE.exec(line)

    if (bold) {
      return sanitizeInlineText(bold[1]!)
    }

    if (line.trim()) {
      break
    }
  }

  if (!signature) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(signature)
    const parts = Array.isArray(parsed) ? parsed : [parsed]

    for (const part of parts) {
      const record = part && typeof part === 'object' ? (part as Record<string, unknown>) : {}

      if (typeof record.type === 'string' && record.type.startsWith('reasoning.summary')) {
        const text = typeof record.summary === 'string' ? record.summary : record.text

        if (typeof text === 'string' && text.trim()) {
          return sanitizeInlineText(text.split('\n')[0]!)
        }
      }
    }
  } catch {
    // A signature that is not JSON simply carries no title.
  }

  return undefined
}

/** A thought's length, never reported as less than a second. */
export function formatThought(ms: number): string {
  return formatElapsed(Math.max(1000, ms))
}

/** What a provider that never timed its own thinking probably spent, read off
 *  how much it wrote. Reading pace, near enough. */
export function estimateThought(characters: number): number {
  return Math.max(1000, Math.round((characters / 150) * 1000))
}

/** The heading over a thought. */
export function heading(options: { elapsedMs: number; live: boolean; title?: string | undefined }): string {
  const time = formatThought(options.elapsedMs)

  if (options.title) {
    return `${options.title} · ${time}`
  }

  return options.live ? `Thinking… · ${time}` : `Thought for ${time}`
}

/** The last `count` rows the thinking text occupies at this width: what the
 *  model is saying now, not what it said first. */
export function previewLines(text: string, width: number, count: number): string[] {
  const rows: string[] = []

  for (const line of text.split('\n')) {
    // A bold title line is the heading already; under it, it would read twice.
    if (TITLE_LINE.test(line)) {
      continue
    }

    for (const row of wrapTextWithAnsi(sanitizeInlineText(line), Math.max(1, width))) {
      if (row.trim()) {
        rows.push(row)
      }
    }
  }

  return rows.slice(-count)
}
