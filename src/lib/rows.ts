// The parts of a Harness tool row that are only text: what a call is called,
// how long it took, and how a line is cut to the width without taking the
// panel's background with it.

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

/** Columns the invocation itself must keep before the expand hint is worth the
 *  room: a row that is only a hint says nothing. pi-fold draws the same line. */
const MIN_INVOCATION = 8

/** A whole escape sequence in text a tool wrote: OSC with either terminator,
 *  and CSI. Taking the sequence out first is what keeps its `[0m` tail from
 *  being drawn as text once the control characters are gone. */
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/g

/**
 * pi-tui's `truncateToWidth` brackets its ellipsis with full resets
 * (`\x1b[0m`), which would end the panel's background there and leave the rest
 * of the row in the terminal's own colours. Everything painted here closes with
 * targeted codes and every piece of foreign text has been sanitized, so a full
 * reset in a truncated line was put there by the truncation itself. Downgraded
 * to "default foreground, bold off", the enclosing background survives.
 */
// eslint-disable-next-line no-control-regex
const FULL_RESET = /\x1b\[0m/g

/** Only what a row paints, so a test can stand in for pi's theme. */
export interface RowTheme {
  bold(text: string): string
  fg(color: 'error' | 'muted' | 'text', text: string): string
}

/** One line of a tool's own text: no sequences, no control characters, no
 *  newlines, whitespace collapsed. */
export function sanitizeInlineText(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
}

/** `text` cut to `width`, with the panel's background left intact. */
export function fit(text: string, width: number): string {
  return truncateToWidth(text, width, '...').replace(FULL_RESET, '\x1b[39m\x1b[22m')
}

/** The invocation, and the hint riding the right of the same row.
 *
 *  `suffix` is kept whole: the text is truncated to leave room for it, so a
 *  long command never eats the expand hint at the end of the row. */
export function composeRow(text: string, suffix: string, width: number): string {
  const room = suffix ? visibleWidth(suffix) + 1 : 0

  return room > 0 && width > room + MIN_INVOCATION ? `${fit(text, width - room)} ${suffix}` : fit(text, width)
}

/** The tool's name, what it was asked to do, and how long it took. */
export function headerText(theme: RowTheme, name: string, label: string, duration: string): string {
  return (
    theme.bold(theme.fg('text', name)) +
    (label ? ` ${theme.fg('muted', label)}` : '') +
    (duration ? theme.fg('muted', ` ${duration}`) : '')
  )
}

/** `340ms`, `1.2s`. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

type Args = Record<string, unknown>

function text(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  return sanitizeInlineText(typeof value === 'string' ? value : (JSON.stringify(value) ?? ''))
}

/** Where a file tool was pointed. `file_path` is not pi's — an MCP tool's, or a
 *  plugin's — and costs one `||` to honour. */
function pathOf(args: Args): string {
  return text(args.path) || text(args.file_path)
}

/**
 * The first argument that is *text*, for a tool with no format of its own.
 *
 * Text, because that is the argument that says what the call was about: a limit
 * or a flag arriving ahead of it in the object is not what the row is for. With
 * no text argument at all the first one keeps its key, because `[{…}]` alone
 * says nothing.
 */
function firstArg(args: Args): string {
  const entries = Object.entries(args)
  const found = entries.find(([, value]) => typeof value === 'string' && value.trim())

  if (found) {
    return text(found[1])
  }

  const entry = entries[0]

  if (!entry) {
    return ''
  }

  const rendered = text(entry[1])

  return rendered ? `${entry[0]}=${rendered}` : entry[0]
}

/**
 * What a collapsed row says was invoked: the shortest thing that identifies the
 * call. The command for `bash`, the file for the file tools, the pattern and
 * where for the search tools, and the first text argument for anything else.
 */
export function invocationSummary(name: string, args: Args = {}): string {
  // A call with no arguments at all is every row a resumed session replays, and
  // a default filled in here would be an invocation that never happened.
  if (Object.keys(args).length === 0) {
    return ''
  }

  switch (name) {
    case 'bash':
      return text(args.command)

    case 'read': {
      const path = pathOf(args)

      return path && typeof args.offset === 'number' ? `${path}:${args.offset}` : path
    }

    case 'edit': {
      const path = pathOf(args)
      const edits = Array.isArray(args.edits) ? args.edits.length : 0

      return edits > 0 ? `${path} (${edits} ${edits === 1 ? 'edit' : 'edits'})` : path
    }

    case 'write':
      return pathOf(args)

    case 'ls':
      return pathOf(args) || '.'

    case 'find':
    case 'grep': {
      const pattern = text(args.pattern)
      const where = pathOf(args) || '.'

      return pattern ? `${pattern} in ${where}` : where
    }

    default:
      return firstArg(args)
  }
}
