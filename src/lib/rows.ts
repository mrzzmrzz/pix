// The geometry of a tool row: how a line is cut, where a path loses its middle,
// how the branch gutter is drawn, and how a trailer reaches the right edge.
// Nothing here knows about pi; everything is text in and text out.

import { homedir } from 'node:os'
import { isAbsolute, relative as relativePath, sep } from 'node:path'

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

/** A whole escape sequence in text a tool wrote: OSC with either terminator,
 *  and CSI. Taking the sequence out first is what keeps its `[0m` tail from
 *  being drawn as text once the control characters are gone. */
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/g

/**
 * pi-tui's `truncateToWidth` brackets its ellipsis with full resets
 * (`\x1b[0m`), which would end an expanded card's background there and leave
 * the rest of the row in the terminal's own colours. Everything painted here
 * closes with targeted codes and every piece of foreign text has been
 * sanitized, so a full reset in a truncated line was put there by the
 * truncation itself. Downgraded to "default foreground, bold off", the
 * enclosing background survives.
 */
// eslint-disable-next-line no-control-regex
const FULL_RESET = /\x1b\[0m/g

/** Splits a header into its left half and the half that rides the right edge.
 *  A private-use codepoint, because it must survive being painted and never
 *  reach the terminal. */
export const TRAILER = ''

/** One line of a tool's own text: no sequences, no control characters, no
 *  newlines, whitespace collapsed. */
export function sanitizeInlineText(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
}

/** `text` cut to `width`, with any enclosing background left intact. */
export function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), '…').replace(FULL_RESET, '\x1b[39m\x1b[22m')
}

/** A path as the transcript should say it: relative to the working directory
 *  when it is inside it, `~` for home, and otherwise exactly as given. */
export function displayPath(value: string, cwd?: string): string {
  const text = sanitizeInlineText(value)

  if (!text || !isAbsolute(text)) {
    return text
  }

  if (cwd && isAbsolute(cwd)) {
    const inside = relativePath(cwd, text)

    if (inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) {
      return inside
    }
  }

  const home = homedir()

  return home && text.startsWith(home + sep) ? `~${text.slice(home.length)}` : text
}

function headTo(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  let head = ''

  for (const char of text) {
    if (visibleWidth(head + char) > width) {
      break
    }

    head += char
  }

  return head
}

function tailTo(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  let tail = ''

  for (const char of [...text].reverse()) {
    if (visibleWidth(char + tail) > width) {
      break
    }

    tail = char + tail
  }

  return tail
}

/**
 * A path cut in the middle rather than the end.
 *
 * The filename is what identifies the call, so it is kept whole and the
 * directories lose their middle. Only when even the filename will not fit does
 * the name itself get cut, and then from both ends so the extension survives.
 */
export function truncatePathToWidth(path: string, width: number): string {
  if (visibleWidth(path) <= width) {
    return path
  }

  if (width <= 1) {
    return width === 1 ? '…' : ''
  }

  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const filename = cut >= 0 ? path.slice(cut + 1) : path

  if (cut >= 0 && visibleWidth(filename) + 1 <= width) {
    const suffix = `${path[cut]!}${filename}`
    const prefix = headTo(path.slice(0, cut), Math.max(0, width - visibleWidth(suffix) - 1))

    return prefix ? `${prefix}…${suffix}` : `…${filename}`
  }

  const left = Math.max(1, Math.floor((width - 1) * 0.45))

  return `${headTo(filename, left)}…${tailTo(filename, Math.max(0, width - left - 1))}`
}

/** A tool's name as a label: `web_fetch` and `webFetch` both become
 *  `Web Fetch`. */
export function humanizeToolName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * A header line with its trailer flushed to the right edge.
 *
 * The gap can only be measured once the width is known, so the two halves
 * travel joined by {@link TRAILER} and are separated here, at render time. A
 * line with no sentinel is simply cut to fit.
 */
export function alignTrailing(line: string, width: number): string {
  const at = line.indexOf(TRAILER)

  if (at === -1) {
    return fit(line, width)
  }

  const left = line.slice(0, at)
  const right = line.slice(at + TRAILER.length)
  const rightWidth = visibleWidth(right)

  if (rightWidth >= width) {
    return fit(right, width)
  }

  const clipped = fit(left, Math.max(0, width - rightWidth - 2))

  return clipped + ' '.repeat(Math.max(1, width - visibleWidth(clipped) - rightWidth)) + right
}

/**
 * The result blocks under a header, each on its own arm of the gutter.
 *
 * One block closes with `└`; several open with `├` and only the last closes.
 * Every row a block occupies after its first — a second source line, or a line
 * that wrapped — keeps the gutter, so the vertical rule is never broken.
 */
export function branch(blocks: readonly (readonly string[])[], width: number, paint: (glyph: string) => string): string[] {
  const rows: string[] = []
  const content = Math.max(1, width - 2)

  blocks.forEach((block, index) => {
    const last = index === blocks.length - 1
    const lead = `${paint(last ? '└' : '├')} `
    const gutter = last ? '  ' : `${paint('│')} `
    let first = true

    for (const line of block) {
      for (const row of wrapTextWithAnsi(line, content)) {
        rows.push((first ? lead : gutter) + row)
        first = false
      }
    }
  })

  return rows
}

/** Added and removed line counts read off a unified patch. */
export function countPatch(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0

  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++
    }
  }

  return { added, removed }
}

/** How many cells the change meter gets at this width, or none at all when the
 *  row is too narrow for it to mean anything. */
function statBarSlots(width: number): number {
  return width < 20 ? 0 : Math.min(20, Math.max(8, Math.floor(width / 14)))
}

/** The meter split between added and removed, as two run lengths. */
export function statBar(added: number, removed: number, width: number): { add: number; remove: number } {
  const slots = statBarSlots(width)
  const total = added + removed

  if (slots === 0 || total === 0) {
    return { add: 0, remove: 0 }
  }

  const add = added === 0 ? 0 : Math.max(1, Math.round((added / total) * slots))

  return { add: Math.min(slots, add), remove: slots - Math.min(slots, add) }
}

/**
 * The last (or first) `limit` non-empty lines of `text`, and how many there
 * were in all.
 *
 * One pass, and never more than `limit` lines held, so a tool that printed a
 * hundred thousand lines costs the same as one that printed five.
 */
export function lineWindow(text: string, limit: number, pick: 'head' | 'tail'): { lines: string[]; total: number } {
  const lines: string[] = []
  let total = 0
  let start = 0

  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(start, end)

    if (line.trim()) {
      total++

      if (pick === 'tail') {
        if (lines.length === limit) {
          lines.shift()
        }

        if (limit > 0) {
          lines.push(line)
        }
      } else if (lines.length < limit) {
        lines.push(line)
      }
    }

    if (newline === -1) {
      break
    }

    start = newline + 1
  }

  return { lines, total }
}

/** `12s`, `1m 12s`, `1h 12m`. */
export function formatElapsed(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${whole % 60}s` : `${whole}s`
}

/** `1 line` / `4 lines`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
