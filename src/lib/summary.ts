// What a tool row says: the verb, what the call was pointed at, and the one
// line a collapsed result gets. One table per question, so the header and the
// summary can never drift apart.

import { displayPath, humanizeToolName, plural, sanitizeInlineText } from './rows.js'

/** Claude Code's verbs, not pi's tool names. */
const VERBS: Record<string, string> = {
  bash: 'Bash',
  edit: 'Edit',
  find: 'Find',
  grep: 'Grep',
  ls: 'List',
  read: 'Read',
  write: 'Write'
}

/** Pi's own write tool says `Successfully wrote to …` whether or not the file
 *  was there before, so `Create` waits for a tool that says so. Checking the
 *  disk instead would be a stat on every render of every history row. */
const CREATED = /\bcreated\b/i

export function verbFor(name: string, label: string | undefined, resultText = ''): string {
  if (name === 'write' && CREATED.test(resultText)) {
    return 'Create'
  }

  return VERBS[name] ?? label ?? humanizeToolName(name)
}

export interface Target {
  /** The muted note after the target: a line range, an edit count. */
  detail: string
  /** True when `text` is a path, which is truncated in the middle. */
  path: boolean
  /** The accent-coloured subject of the call. */
  text: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? sanitizeInlineText(value) : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function pathArg(args: Record<string, unknown>, cwd?: string): string {
  const raw = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : ''

  return raw ? displayPath(raw, cwd) : ''
}

/** The first operative line of a shell script: what the user would call the
 *  command, skipping the shebang, comments and blanks. */
function operativeCommand(command: string): { first: string; lines: number } {
  const lines = command.split('\n').filter(line => line.trim())
  const first = lines.find(line => !line.trim().startsWith('#')) ?? lines[0] ?? ''

  return { first: sanitizeInlineText(first), lines: lines.length }
}

function search(args: Record<string, unknown>, cwd?: string): Target {
  const pattern = str(args.pattern)
  const where = pathArg(args, cwd)

  return { detail: where ? ` in ${where}` : '', path: false, text: pattern ? `"${pattern}"` : '' }
}

/** What the header says the call was pointed at. */
export function targetOf(name: string, args: Record<string, unknown>, cwd?: string): Target {
  switch (name) {
    case 'bash': {
      // The raw command, because the line breaks are what tells one command
      // from the next and sanitizing would collapse them away.
      const { first, lines } = operativeCommand(typeof args.command === 'string' ? args.command : '')

      return { detail: lines > 1 ? ` · ${plural(lines, 'line')}` : '', path: false, text: first }
    }

    case 'read': {
      const offset = num(args.offset)
      const limit = num(args.limit)
      const range = [offset === undefined ? '' : `offset=${offset}`, limit === undefined ? '' : `limit=${limit}`]
        .filter(Boolean)
        .join(', ')

      return { detail: range ? ` (${range})` : '', path: true, text: pathArg(args, cwd) }
    }

    case 'edit': {
      const edits = Array.isArray(args.edits) ? args.edits.length : 0

      return { detail: edits > 1 ? ` (${plural(edits, 'edit')})` : '', path: true, text: pathArg(args, cwd) }
    }

    case 'write':
      return { detail: '', path: true, text: pathArg(args, cwd) }

    case 'ls':
      return { detail: '', path: true, text: pathArg(args, cwd) || '.' }

    case 'find':
    case 'grep':
      return search(args, cwd)

    default: {
      // Anything pix does not know: the first argument that reads like a
      // subject, which is what the row is for.
      for (const key of ['path', 'file_path', 'url', 'query', 'pattern', 'name', 'prompt']) {
        const value = str(args[key])

        if (value) {
          return { detail: '', path: key === 'path' || key === 'file_path', text: value }
        }
      }

      const first = Object.entries(args).find(([, value]) => typeof value === 'string' && value.trim())

      return { detail: '', path: false, text: first ? sanitizeInlineText(first[1] as string) : '' }
    }
  }
}

export type Tone = 'error' | 'muted' | 'success'

export interface Collapsed {
  /** A muted note after the main text. */
  detail: string
  text: string
  tone: Tone
  /** A note in `warning`: today, only that the tool cut its own output. */
  warn: string
}

const EMPTY: Collapsed = { detail: '', text: '', tone: 'muted', warn: '' }

/** The one line a collapsed result gets, in Claude Code's vocabulary. */
export function collapsedSummary(
  name: string,
  output: string,
  options: { isError: boolean; lines: number; truncated: boolean }
): Collapsed {
  const { isError, lines, truncated } = options

  if (isError) {
    const exit = /Command exited with code (\d+)/.exec(output)
    const first = output.split('\n').find(line => line.trim()) ?? ''

    return name === 'bash' && exit
      ? { detail: ` (${plural(lines, 'line')})`, text: `Exit ${exit[1]}`, tone: 'error', warn: '' }
      : { detail: '', text: sanitizeInlineText(first) || 'Failed', tone: 'error', warn: '' }
  }

  const warn = truncated ? ' (truncated)' : ''

  switch (name) {
    case 'read':
      return { ...EMPTY, text: `${plural(lines, 'line')} loaded`, warn }

    case 'bash':
      return { detail: ` (${plural(lines, 'line')})`, text: 'Done', tone: 'success', warn }

    case 'grep':
      return { ...EMPTY, text: /^no matches/i.test(output) ? 'no matches' : plural(lines, 'match', 'matches'), warn }

    case 'find':
      return { ...EMPTY, text: lines === 0 ? 'no files found' : plural(lines, 'file'), warn }

    case 'ls':
      return { ...EMPTY, text: /^\(empty directory\)/.test(output) ? 'empty directory' : plural(lines, 'entry', 'entries'), warn }

    case 'write':
      return { ...EMPTY, detail: lines > 0 ? ` (+${plural(lines, 'line')})` : '', text: CREATED.test(output) ? 'Created' : 'Wrote' }

    default:
      return { ...EMPTY, text: `${plural(lines, 'line')} returned`, warn }
  }
}

/** Arguments in the order a person would read them, then alphabetical. */
const FIELD_ORDER = [
  'path',
  'file_path',
  'command',
  'query',
  'pattern',
  'url',
  'name',
  'message',
  'content',
  'old_string',
  'new_string'
]

/** The `key: value` rows of the expanded Input section. */
export function inputRows(args: Record<string, unknown>): { key: string; value: string }[] {
  const keys = Object.keys(args).sort((a, b) => {
    const left = FIELD_ORDER.indexOf(a)
    const right = FIELD_ORDER.indexOf(b)

    if (left !== right) {
      return (left === -1 ? FIELD_ORDER.length : left) - (right === -1 ? FIELD_ORDER.length : right)
    }

    return a.localeCompare(b)
  })

  return keys.map(key => ({
    key,
    value: sanitizeInlineText(typeof args[key] === 'string' ? (args[key] as string) : (JSON.stringify(args[key]) ?? ''))
  }))
}
