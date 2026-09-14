// What a turn did, in one sentence.

import { displayPath, formatElapsed, plural } from './rows.js'

export interface TurnWork {
  /** Every tool call of the turn, in order, as `{name, path}`. */
  calls: readonly { name: string; path?: string | undefined }[]
  elapsedMs: number
}

/** `Ran 4 commands, read 7 files, edited 2 files · 1m 12s`.
 *
 *  Files are counted once however often they were touched: reading the same
 *  file three times is one file, and saying otherwise would flatter the turn. */
export function summarize(work: TurnWork, cwd?: string): string {
  const read = new Set<string>()
  const edited = new Set<string>()
  let commands = 0
  let other = 0

  for (const call of work.calls) {
    const path = call.path ? displayPath(call.path, cwd) : ''

    if (call.name === 'bash') {
      commands++
    } else if (call.name === 'read') {
      read.add(path || `read:${read.size}`)
    } else if (call.name === 'edit' || call.name === 'write') {
      edited.add(path || `edit:${edited.size}`)
    } else {
      other++
    }
  }

  const parts = [
    commands > 0 ? `Ran ${plural(commands, 'command')}` : '',
    read.size > 0 ? `read ${plural(read.size, 'file')}` : '',
    edited.size > 0 ? `edited ${plural(edited.size, 'file')}` : '',
    other > 0 ? `${plural(other, 'other call')}` : ''
  ].filter(Boolean)

  if (parts.length === 0) {
    return ''
  }

  // The first clause opens the sentence, so it keeps its capital; the rest run
  // on. A turn that only read files still starts with a capital.
  const text = parts.join(', ')

  return `${text.charAt(0).toUpperCase()}${text.slice(1)} · ${formatElapsed(work.elapsedMs)}`
}
