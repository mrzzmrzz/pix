/**
 * One line in the transcript saying what the turn did:
 *
 *   ✻ Ran 4 commands, read 7 files, edited 2 files · 1m 12s
 *
 * Claude Code puts it where the turn ends, and so does this. It is a session
 * entry, which means it is drawn in the transcript, survives a resume, and is
 * never sent to the model. Turns with fewer than two tool calls do not get one:
 * a single call has already said everything on its own row.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { Text } from '@earendil-works/pi-tui'

import { summarize, type TurnWork } from './lib/turn.js'

const ENTRY = 'pix-turn-summary'

/** Fewer than this and the tool rows above already say it better. */
const MINIMUM_CALLS = 2

interface Call {
  name: string
  path?: string | undefined
}

function pathOf(args: unknown): string | undefined {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const value = typeof record.path === 'string' ? record.path : record.file_path

  return typeof value === 'string' ? value : undefined
}

export default function (pi: ExtensionAPI) {
  /** Arguments arrive when a call starts; only a call that finished counts, so
   *  the two events are joined by the call id. */
  const started = new Map<string, Call>()
  let calls: Call[] = []
  let startedAt = 0

  pi.registerEntryRenderer<TurnWork & { text?: string }>(ENTRY, (entry, _options, theme) => {
    const text = entry.data?.text ?? (entry.data ? summarize(entry.data) : '')

    return text ? new Text(theme.fg('muted', `✻ ${text}`), 1, 0) : undefined
  })

  pi.on('agent_start', () => {
    started.clear()
    calls = []
    startedAt = Date.now()
  })

  pi.on('tool_execution_start', event => {
    started.set(event.toolCallId, { name: event.toolName, path: pathOf(event.args) })
  })

  pi.on('tool_execution_end', event => {
    calls.push(started.get(event.toolCallId) ?? { name: event.toolName })
    started.delete(event.toolCallId)
  })

  pi.on('agent_end', (_event, ctx) => {
    started.clear()

    if (calls.length < MINIMUM_CALLS) {
      calls = []

      return
    }

    const work: TurnWork = { calls, elapsedMs: Date.now() - startedAt }
    const text = summarize(work, ctx.cwd)

    calls = []

    if (text) {
      // The sentence is stored, not recomputed: a resumed session must read the
      // same line it read before, whatever pix does to the wording later.
      pi.appendEntry(ENTRY, { ...work, text })
    }
  })
}
