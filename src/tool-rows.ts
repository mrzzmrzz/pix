/**
 * Claude Code's tool rows, on pi's own tool renderers.
 *
 *   ● Read src/providers/compat.py
 *   └ 412 lines loaded • ctrl+o to toggle
 *
 * A settled call is a filled dot, a verb, what it was pointed at, and one line
 * saying what came back. While it runs the dot is a braille spinner and bash
 * keeps a live tail of its output. Expanded, the row becomes a filled card with
 * the call's arguments above pi's own result renderer, so `edit` still shows
 * pi's diff and `read` still shows pi's highlighting.
 *
 * The mechanism is public API throughout: pi's seven built-in tool definitions
 * are rebuilt, wrapped in new `renderCall` and `renderResult`, given
 * `renderShell: "self"`, and registered again. Nothing about the tools
 * themselves changes, and nothing here reaches the model. A tool name another
 * extension already owns is left alone.
 */
import type { ExtensionAPI, ToolDefinition as PiToolDefinition, ToolsOptions } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  keyText,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import { Box, Container, visibleWidth } from '@earendil-works/pi-tui'

import type { Tone } from './lib/summary.js'

import {
  alignTrailing,
  branch,
  countPatch,
  fit,
  formatElapsed,
  lineWindow,
  plural,
  sanitizeInlineText,
  statBar,
  TRAILER,
  truncatePathToWidth
} from './lib/rows.js'
import { collapsedSummary, inputRows, targetOf, verbFor } from './lib/summary.js'

type ToolDefinition = PiToolDefinition<any, any, any>
type RenderResultParams = Parameters<NonNullable<ToolDefinition['renderResult']>>
type RenderTheme = RenderResultParams[2]
type RenderContext = RenderResultParams[3]

/** One turn of the braille wheel every 80 ms, as fast as motion reads without
 *  becoming a flicker. */
const SPINNER = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const SPINNER_MS = 80

/** Output lines kept under a running call. */
const PREVIEW_LINES = 5

/** Rows of arguments the expanded Input section shows before it says how many
 *  more there are. */
const INPUT_LINES = 5

/** What the call and result renderers of one row share. Pi hands both the same
 *  object and keeps it for the life of the row. */
interface RowState {
  clock?: NodeJS.Timeout | undefined
  endedAt?: number | undefined
  /** The header once the arguments stopped streaming, so it cannot flicker. */
  frozen?: { detail: string; target: string; verb: string } | undefined
  lines?: number | undefined
  output?: string | undefined
  /** Bash keeps its tail after it finishes, until the assistant speaks again. */
  preserve?: boolean | undefined
  startedAt?: number | undefined
  truncated?: boolean | undefined
}

// ---------------------------------------------------------------- animation

/**
 * Every row waiting on a tool. One timer for all of them, stopped the moment
 * the last one settles: nothing of pix's may hold the process open.
 *
 * Keyed by call id, because pi builds a fresh context object for every render
 * pass and the row a set held would never be the row that settles.
 */
const pending = new Map<string, RenderContext>()
let wheel: NodeJS.Timeout | undefined
let frame = 0

function animate(context: RenderContext): void {
  pending.set(context.toolCallId, context)

  if (wheel !== undefined) {
    return
  }

  wheel = setInterval(() => {
    frame = (frame + 1) % SPINNER.length

    for (const waiting of [...pending.values()]) {
      waiting.invalidate()
    }

    if (pending.size === 0) {
      stopWheel()
    }
  }, SPINNER_MS)
  wheel.unref()
}

function stopWheel(): void {
  clearInterval(wheel)
  wheel = undefined
}

function settle(context: RenderContext): void {
  pending.delete(context.toolCallId)

  if (pending.size === 0) {
    stopWheel()
  }
}

/**
 * Bash rows still showing the tail of what they printed.
 *
 * A finished command's last lines stay on screen, because they are usually the
 * answer. They go when the assistant speaks or another tool starts, which is
 * when the transcript has moved on.
 */
const preserved = new Map<string, RenderContext>()

function clearTails(): void {
  for (const context of [...preserved.values()]) {
    ;(context.state as RowState).preserve = false
    context.invalidate()
  }

  preserved.clear()
}

/** Every armed per-row clock, so `session_shutdown` can let go of all of them
 *  at once. */
const clocks = new Set<NodeJS.Timeout>()

function tick(state: RowState, context: RenderContext): void {
  if (state.clock !== undefined) {
    return
  }

  const clock = setInterval(() => context.invalidate(), 1000)

  clock.unref()
  clocks.add(clock)
  state.clock = clock
}

function stopClock(state: RowState): void {
  if (state.clock !== undefined) {
    clearInterval(state.clock)
    clocks.delete(state.clock)
    state.clock = undefined
  }
}

// ------------------------------------------------------------------ pieces

/** A component whose rows are recomputed on every render, so it can read the
 *  state the other renderer of the same row wrote after it was built. */
class Rows extends Container {
  private lines: (width: number) => string[] = () => []

  setLines(lines: (width: number) => string[]): void {
    this.lines = lines
    this.invalidate()
  }

  override render(width: number): string[] {
    return this.lines(width)
  }
}

class CallRows extends Rows {}
class ResultRows extends Rows {}

/** pix's own panel. A subclass because pi's `edit` renderer returns a `Box` of
 *  its own, and the two must never be mistaken for each other. */
class Shell extends Box {}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** The text a result carries, whichever shape it arrived in. */
function resultText(result: unknown): string {
  const record = asRecord(result)

  if (typeof record.output === 'string') {
    return record.output
  }

  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      const inner = asRecord(block)

      if (inner.type === 'text' && typeof inner.text === 'string' && inner.text) {
        return inner.text
      }
    }
  }

  return typeof result === 'string' ? result : ''
}

function detailsOf(result: unknown): Record<string, unknown> {
  return asRecord(asRecord(result).details)
}

/** The dot, or the wheel while the call is in flight. */
function icon(theme: RenderTheme, state: RowState, context: RenderContext): string {
  if (!context.executionStarted && state.endedAt === undefined) {
    // Arguments are still streaming: the row exists but nothing has run.
    return theme.bold(theme.fg('dim', '●'))
  }

  if (state.endedAt === undefined) {
    return theme.fg('accent', SPINNER[frame]!)
  }

  return theme.bold(theme.fg(context.isError ? 'error' : 'success', '●'))
}

/** The expand affordance: pi's real key, painted in the row's own theme rather
 *  than the global one pi's own `keyHint` reaches for. */
function hint(theme: RenderTheme, expanded: boolean): string {
  const key = keyText('app.tools.expand') || 'ctrl+o'

  return theme.fg('muted', ' • ') + theme.fg('dim', key) + theme.fg('muted', expanded ? ' to collapse' : ' to toggle')
}

function gutter(theme: RenderTheme): (glyph: string) => string {
  return glyph => theme.fg('dim', glyph)
}

// ------------------------------------------------------------------ header

function renderCall(name: string, label: string | undefined, args: unknown, theme: RenderTheme, context: RenderContext): Component {
  const state = context.state as RowState

  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now()
  }

  if (context.executionStarted && state.endedAt === undefined) {
    animate(context)

    if (name === 'bash') {
      tick(state, context)
    }
  }

  // Frozen once the arguments stop streaming, so a half-built path does not
  // flicker in the header while the model is still typing it.
  const record = asRecord(args)
  const target = targetOf(name, record, context.cwd)
  const verb = verbFor(name, label, state.output ?? '')

  if (context.argsComplete && state.frozen === undefined) {
    state.frozen = { detail: target.detail, target: target.text, verb }
  }

  const shown = state.frozen ?? { detail: target.detail, target: target.text, verb }
  const box = shell(context, theme, state)
  const component = box.children[0] instanceof CallRows ? box.children[0] : new CallRows()

  component.setLines(width => {
    // The box already insets one column, so the icon starts the row and sits
    // in the same column as the `└` of the result block under it.
    const head = `${icon(theme, state, context)} ${theme.bold(theme.fg('toolTitle', shown.verb))}`
    const room = Math.max(8, width - visibleWidth(sanitizeInlineText(shown.verb)) - 3 - visibleWidth(shown.detail))
    const text = target.path ? truncatePathToWidth(shown.target, room) : shown.target
    const line =
      head +
      (text ? ` ${theme.fg('accent', text)}` : '') +
      (shown.detail ? theme.fg('muted', shown.detail) : '') +
      trailer(theme, name, state)

    return [alignTrailing(line, width)]
  })

  return mount(box, component)
}

/** Bash alone gets metadata on the right edge: how much it has printed and how
 *  long it has been at it. */
function trailer(theme: RenderTheme, name: string, state: RowState): string {
  if (name !== 'bash' || state.startedAt === undefined) {
    return ''
  }

  const elapsed = formatElapsed((state.endedAt ?? Date.now()) - state.startedAt)
  const counted = state.lines === undefined ? '' : `${plural(state.lines, 'line')} · `

  return TRAILER + theme.fg('muted', `${counted}${elapsed}`)
}

// ------------------------------------------------------------------ result

function renderResult(
  base: ToolDefinition,
  result: RenderResultParams[0],
  options: RenderResultParams[1],
  theme: RenderTheme,
  context: RenderContext
): Component {
  const state = context.state as RowState
  const output = resultText(result)
  const details = detailsOf(result)

  const window = lineWindow(output, PREVIEW_LINES, base.name === 'bash' ? 'tail' : 'head')

  state.output = output
  state.lines = window.total
  state.truncated = asRecord(details.truncation).truncated === true

  if (!options.isPartial) {
    state.endedAt ??= Date.now()
    settle(context)
    stopClock(state)

    if (base.name === 'bash') {
      state.preserve = true
      preserved.set(context.toolCallId, context)
    }
  }

  const box = shell(context, theme, state)

  if (options.expanded) {
    return mount(box, expanded(base, result, options, theme, context, state))
  }

  const held = box.children[0]
  const component = held instanceof ResultRows ? held : new ResultRows()

  component.setLines(width => collapsedRows(base.name, output, window, details, theme, context, state, width))

  return mount(box, component)
}

/** The branch under a collapsed header: one summary line, and for bash the tail
 *  of what it printed. */
function collapsedRows(
  name: string,
  output: string,
  window: { lines: string[]; total: number },
  details: Record<string, unknown>,
  theme: RenderTheme,
  context: RenderContext,
  state: RowState,
  width: number
): string[] {
  const running = state.endedAt === undefined
  const block: string[] = []

  if (running) {
    block.push(
      window.total > window.lines.length
        ? theme.fg('muted', `... (${plural(window.total - window.lines.length, 'earlier line')})`)
        : theme.fg('muted', 'Running…')
    )
  } else {
    block.push(summaryLine(name, output, details, theme, context, state, width))
  }

  // Bash keeps its tail after it finishes, so the last thing a command said
  // stays on screen until the assistant answers or another tool starts.
  if (running || (name === 'bash' && state.preserve === true)) {
    block.push(...window.lines.map(line => theme.fg('dim', fit(sanitizeInlineText(line), Math.max(1, width - 4)))))
  }

  return branch([block], width, gutter(theme))
}

function summaryLine(
  name: string,
  output: string,
  details: Record<string, unknown>,
  theme: RenderTheme,
  context: RenderContext,
  state: RowState,
  width: number
): string {
  if (name === 'edit' && !context.isError) {
    return editSummary(details, theme, width) + hint(theme, false)
  }

  // A write's result is one line of confirmation, so the count that means
  // anything is the number of lines it was given to write.
  const written =
    name === 'write' ? lineWindow(String(asRecord(context.args).content ?? ''), 0, 'head').total : undefined
  const summary = collapsedSummary(name, output, {
    isError: context.isError,
    lines: written ?? state.lines ?? 0,
    truncated: state.truncated === true
  })
  const tone: Tone = summary.tone

  return (
    theme.fg(tone, summary.text) +
    (summary.detail ? theme.fg('muted', summary.detail) : '') +
    (summary.warn ? theme.fg('warning', summary.warn) : '') +
    (expandable(output, context) ? hint(theme, false) : '')
  )
}

/** `+14 -6 [━━━━━] at line 88`. */
function editSummary(details: Record<string, unknown>, theme: RenderTheme, width: number): string {
  const patch = typeof details.patch === 'string' ? details.patch : typeof details.diff === 'string' ? details.diff : ''
  const { added, removed } = countPatch(patch)
  const bar = statBar(added, removed, width)
  const meter =
    bar.add + bar.remove === 0
      ? ''
      : ` ${theme.fg('dim', '[')}${theme.fg('toolDiffAdded', '━'.repeat(bar.add))}${theme.fg('toolDiffRemoved', '━'.repeat(bar.remove))}${theme.fg('dim', ']')}`
  const at = typeof details.firstChangedLine === 'number' ? theme.fg('muted', ` at line ${details.firstChangedLine}`) : ''

  return `${theme.fg('toolDiffAdded', `+${added}`)} ${theme.fg('toolDiffRemoved', `-${removed}`)}${meter}${at}`
}

/** Whether there is anything behind the expand key: output worth reading, or
 *  arguments worth seeing. */
function expandable(output: string, context: RenderContext): boolean {
  return output.includes('\n') || Object.keys(asRecord(context.args)).length > 0
}

// ---------------------------------------------------------------- expanded

/** The Input / Output frame: what the tool was asked, then what pi's own
 *  renderer makes of what came back. */
function expanded(
  base: ToolDefinition,
  result: RenderResultParams[0],
  options: RenderResultParams[1],
  theme: RenderTheme,
  context: RenderContext,
  state: RowState
): Component {
  const held = context.lastComponent instanceof Shell ? context.lastComponent.children[0] : context.lastComponent
  const delegate = base.renderResult?.(result, options, theme, {
    ...context,
    lastComponent: held instanceof ResultRows ? undefined : held
  })
  const component = held instanceof ResultRows ? held : new ResultRows()
  const rows = inputRows(asRecord(context.args))

  component.setLines(width => {
    const blocks: string[][] = []

    if (rows.length > 0) {
      const shown = rows.slice(0, INPUT_LINES)
      const input = [theme.bold(theme.fg('accent', 'Input'))]

      for (const { key, value } of shown) {
        input.push(theme.fg('dim', `${key}: `) + theme.fg('muted', fit(value, Math.max(1, width - 4 - key.length))))
      }

      if (rows.length > shown.length) {
        input.push(theme.fg('muted', `… +${plural(rows.length - shown.length, 'more line')}`))
      }

      blocks.push(input)
    }

    const output = [theme.bold(theme.fg('accent', 'Output'))]

    // Pi's own renderer, indented onto the closing arm so the card reads as one
    // block. No cap of ours: expanding is the request to see all of it.
    for (const line of delegate?.render(Math.max(1, width - 4)) ?? []) {
      output.push(line)
    }

    return branch([...blocks, output], width, gutter(theme))
  })

  state.preserve = false
  preserved.delete(context.toolCallId)

  return component
}

// ------------------------------------------------------------------- shell

/**
 * The row's frame.
 *
 * Collapsed rows carry no background, which is how Claude Code draws them: the
 * box is there only for its one column of inset. Expanded, the same box is
 * filled by state and the row becomes a card.
 */
function shell(context: RenderContext, theme: RenderTheme, state: RowState): Shell {
  const box = context.lastComponent instanceof Shell ? context.lastComponent : new Shell(1, 0)

  box.setBgFn(
    context.expanded
      ? text =>
          theme.bg(
            state.endedAt === undefined ? 'toolPendingBg' : context.isError ? 'toolErrorBg' : 'toolSuccessBg',
            text
          )
      : undefined
  )

  return box
}

function mount(box: Shell, child: Component): Shell {
  if (box.children[0] !== child) {
    box.clear()
    box.addChild(child)
  }

  return box
}

// -------------------------------------------------------------- definition

function fold(base: ToolDefinition): ToolDefinition {
  return {
    ...base,
    renderCall: (args, theme, context) => renderCall(base.name, base.label, args, theme, context),
    renderResult: (result, options, theme, context) => renderResult(base, result, options, theme, context),
    renderShell: 'self'
  }
}

/** Pi's built-ins, built the way pi builds them, so the wrapped tools behave
 *  exactly as the originals in everything but their drawing. */
function baseTools(cwd: string): ToolDefinition[] {
  let options: ToolsOptions | undefined

  try {
    const settings = SettingsManager.create(cwd)
    const commandPrefix = settings.getShellCommandPrefix()
    const shellPath = settings.getShellPath()

    options = {
      bash: {
        ...(commandPrefix === undefined ? {} : { commandPrefix }),
        ...(shellPath === undefined ? {} : { shellPath })
      },
      read: { autoResizeImages: settings.getImageAutoResize() }
    }
  } catch {
    options = undefined
  }

  return [
    createBashToolDefinition(cwd, options?.bash),
    createEditToolDefinition(cwd, options?.edit),
    createFindToolDefinition(cwd, options?.find),
    createGrepToolDefinition(cwd, options?.grep),
    createLsToolDefinition(cwd, options?.ls),
    createReadToolDefinition(cwd, options?.read),
    createWriteToolDefinition(cwd, options?.write)
  ] as ToolDefinition[]
}

/** Names another extension has already claimed. Two extensions re-registering
 *  the same tool would fight over it, and the one that loaded last would win by
 *  accident, so pix stands down. */
function claimedElsewhere(pi: ExtensionAPI): Set<string> {
  try {
    return new Set(
      pi
        .getAllTools()
        .filter(tool => typeof tool.sourceInfo?.source === 'string' && tool.sourceInfo.source !== 'builtin')
        .map(tool => tool.name)
    )
  } catch {
    // Before the runtime is bound there is nobody to yield to.
    return new Set()
  }
}

const ON = 'Tool rows are on: a collapsed call is one line, and its output waits for the expand key.'
const OFF = "Tool rows are off: pi's own tool renderers are back."

export default function (pi: ExtensionAPI) {
  let styled = true

  const register = (cwd: string) => {
    const claimed = claimedElsewhere(pi)

    for (const tool of baseTools(cwd)) {
      if (!claimed.has(tool.name)) {
        pi.registerTool(styled ? fold(tool) : tool)
      }
    }
  }

  pi.on('session_start', (_event, ctx) => {
    register(ctx.cwd)
  })

  // A finished bash tail belongs to the moment it finished in.
  pi.on('message_update', event => {
    const content = (event.message as { content?: unknown }).content

    if (Array.isArray(content) && content.some(block => asRecord(block).type === 'text' && asRecord(block).text)) {
      clearTails()
    }
  })

  pi.on('tool_execution_start', () => {
    clearTails()
  })

  pi.on('session_shutdown', () => {
    preserved.clear()
    pending.clear()
    stopWheel()

    for (const clock of [...clocks]) {
      clearInterval(clock)
      clocks.delete(clock)
    }
  })

  pi.registerCommand('tool-rows', {
    description: "Claude Code's tool rows, with the output behind the expand key",
    getArgumentCompletions: prefix => {
      const query = prefix.trim().toLowerCase()
      const matches = ['on', 'off', 'toggle', 'status'].filter(action => action.startsWith(query))

      return matches.length > 0 ? matches.map(value => ({ label: value, value })) : null
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || 'toggle'

      if (action === 'status') {
        ctx.ui.notify(styled ? ON : OFF, 'info')

        return
      }

      if (action !== 'on' && action !== 'off' && action !== 'toggle') {
        ctx.ui.notify('Usage: /tool-rows on | off | toggle | status', 'warning')

        return
      }

      styled = action === 'toggle' ? !styled : action === 'on'
      register(ctx.cwd)
      ctx.ui.notify(styled ? ON : OFF, 'info')
    }
  })
}
