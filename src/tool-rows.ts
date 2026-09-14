/**
 * The Harness tool panel, on pi's own tool renderers.
 *
 * A collapsed call is one line: what was invoked, the time it took, and the
 * expand key at the right of the row. A successful call's output is not shown
 * at all, because the panel already says which file was read and the file is
 * one key away. A failure keeps its first line, because a tool that failed has
 * to be visible without being expanded first. Expanded, the header stays and
 * pi's own renderer draws the result with its highlighting and diffs.
 *
 * The mechanism is the owner's `pi-fold` extension's, which is public API: pi's
 * built-in tool definitions are rebuilt, wrapped in new `renderCall` and
 * `renderResult`, and registered again. Nothing about the tools themselves
 * changes, and nothing here reaches the model: what the tool returned to the
 * conversation was settled before these renderers saw a word of it.
 *
 * The panel is pix's own shell, declared with `renderShell: "self"`. Pi's
 * default shell is a `Box` with a row of padding above and below, so a one-line
 * call is three rows of tint; the Harness panel is exactly as tall as what is in
 * it. Both slots return a box of their own with the same background, and two
 * such boxes stack without a seam.
 *
 * pix and pi-fold override the same seven tools. Run one or the other.
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
  keyHint,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import { Box, Container } from '@earendil-works/pi-tui'

import type { RowTheme } from './lib/rows.js'

import { composeRow, fit, formatDuration, headerText, invocationSummary, sanitizeInlineText } from './lib/rows.js'

type ToolDefinition = PiToolDefinition<any, any, any>
type RenderResultParams = Parameters<NonNullable<ToolDefinition['renderResult']>>
type RenderTheme = RenderResultParams[2] & RowTheme
type RenderContext = RenderResultParams[3]

/**
 * A call still pending this long grows one quiet reassurance row, and at the
 * second deadline that row is rewritten. There is no third.
 */
const REASSURANCES = [
  { after: 8_000, text: 'still running… · waiting 8s' },
  { after: 18_000, text: 'still working… · waiting 18s' }
] as const

/** What the call and result renderers of one row share. Pi hands both the same
 *  object and keeps it for the life of the row. */
interface RowState {
  endedAt?: number | undefined
  progress?: string | undefined
  reassurance?: string | undefined
  startedAt?: number | undefined
  stop?: (() => void) | undefined
  truncated?: boolean | undefined
}

/** Every armed reassurance timer, so `session_shutdown` can let go of all of
 *  them at once. A timer must never outlive the row, let alone the process. */
const armed = new Set<() => void>()

function arm(state: RowState, invalidate: () => void): void {
  if (state.stop !== undefined) {
    return
  }

  const timers = REASSURANCES.map(({ after, text }) => {
    const timer = setTimeout(() => {
      state.reassurance = text
      invalidate()
    }, after)

    timer.unref()

    return timer
  })

  const stop = () => {
    for (const timer of timers) {
      clearTimeout(timer)
    }

    armed.delete(stop)
  }

  state.stop = stop
  armed.add(stop)
}

/** The call is over: drop the timers and the rows that only mean "still
 *  waiting". */
function settle(state: RowState): void {
  state.stop?.()
  state.stop = undefined
  state.progress = undefined
  state.reassurance = undefined
}

/** A component whose rows are recomputed on every render, so it can read the
 *  state the other renderer of the same row wrote after it was built. */
class Rows extends Container {
  private lines: (width: number) => string[] = () => []

  setLines(lines: (width: number) => string[]): void {
    this.lines = lines
    this.invalidate()
  }

  override render(width: number): string[] {
    return this.lines(width).filter(line => line !== '')
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

/** Whether the tool said it cut its own output short. Only `bash` and `read`
 *  report it; for the rest this is simply absent. */
function wasTruncated(result: unknown): boolean {
  return asRecord(asRecord(asRecord(result).details).truncation).truncated === true
}

function lineOf(output: string, pick: 'first' | 'last'): string {
  const lines = output.split('\n').filter(line => line.trim())
  const line = pick === 'first' ? lines[0] : lines.at(-1)

  return line === undefined ? '' : sanitizeInlineText(line)
}

/** The hint that rides the right of a folded row, and the one thing about a
 *  hidden result the row would otherwise not say. */
function foldHint(theme: RenderTheme, truncated: boolean): string {
  return (
    theme.fg('muted', '(') +
    (truncated ? theme.fg('muted', 'truncated; ') : '') +
    keyHint('app.tools.expand', 'to expand') +
    theme.fg('muted', ')')
  )
}

/**
 * The tint, decided when the row is drawn rather than when it is built.
 *
 * The call renderer runs before the result renderer of the same pass, so at
 * build time it has not yet been told the call is over. Reading the state inside
 * the paint keeps the two boxes of one panel the same colour in every frame.
 */
function shellBg(theme: RenderTheme, state: RowState, context: RenderContext): (text: string) => string {
  return text =>
    theme.bg(
      context.isPartial || state.endedAt === undefined
        ? 'toolPendingBg'
        : context.isError
          ? 'toolErrorBg'
          : 'toolSuccessBg',
      text
    )
}

/** The slot's own panel: one column of inset, no padding rows, kept across
 *  renders so the row is not rebuilt on every frame. */
function shell(context: RenderContext, bg: (text: string) => string): Shell {
  const box = context.lastComponent instanceof Shell ? context.lastComponent : new Shell(1, 0)

  box.setBgFn(bg)

  return box
}

/** Put `child` in the box, and only disturb the box when it is a different
 *  component than the one already there. */
function mount(box: Shell, child: Component): Shell {
  if (box.children[0] !== child) {
    box.clear()
    box.addChild(child)
  }

  return box
}

function renderCall(name: string, args: unknown, theme: RenderTheme, context: RenderContext): Component {
  const state = context.state as RowState

  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now()
  }

  // Running is "started and not ended". Pi's `isPartial` would say the same
  // today, but the end time is what the rest of this row keys on, so the two
  // can never disagree.
  if (context.executionStarted && state.endedAt === undefined) {
    arm(state, context.invalidate)
  }

  const box = shell(context, shellBg(theme, state, context))
  const component = box.children[0] instanceof CallRows ? box.children[0] : new CallRows()
  const label = invocationSummary(name, asRecord(args))
  const folded = !context.expanded

  // Read lazily: the result renderer of this same row runs after this one and
  // writes the progress, the truncation flag and the end time into `state`.
  component.setLines(width => {
    const running = context.executionStarted && state.endedAt === undefined
    const duration =
      state.startedAt !== undefined && state.endedAt !== undefined
        ? formatDuration(state.endedAt - state.startedAt)
        : ''
    const suffix = folded && state.endedAt !== undefined ? foldHint(theme, state.truncated === true) : ''

    return [
      composeRow(headerText(theme, name, label, duration), suffix, width),
      // What the tool actually reported outranks the fact that we are waiting
      // for it, so progress goes above the reassurance rather than instead.
      ...(running && state.progress ? [fit(theme.fg('muted', state.progress), width)] : []),
      ...(running && state.reassurance ? [fit(theme.fg('muted', state.reassurance), width)] : [])
    ]
  })

  return mount(box, component)
}

function renderResult(
  base: ToolDefinition,
  result: RenderResultParams[0],
  options: RenderResultParams[1],
  theme: RenderTheme,
  context: RenderContext
): Component {
  const state = context.state as RowState

  state.progress = lineOf(resultText(result), 'last')
  state.truncated = wasTruncated(result)

  if (!options.isPartial) {
    state.endedAt ??= Date.now()
    settle(state)
  }

  if (options.expanded && base.renderResult) {
    // Pi's own renderer expects its own component back in the slot, never ours.
    // `edit` draws its diff inside a frame of its own — it is the one built-in
    // that already asked for `renderShell: "self"` — so it is handed back as it
    // is rather than boxed a second time.
    const held = context.lastComponent instanceof Shell ? context.lastComponent.children[0] : context.lastComponent
    const delegated = { ...context, lastComponent: held instanceof ResultRows ? undefined : held }
    const delegate = base.renderResult(result, options, theme, delegated)

    return base.renderShell === 'self' ? delegate : mount(shell(context, shellBg(theme, state, context)), delegate)
  }

  const box = shell(context, shellBg(theme, state, context))
  const held = box.children[0]
  const component = held instanceof ResultRows ? held : new ResultRows()

  if (context.isError) {
    const first = lineOf(resultText(result), 'first') || '[no output]'

    component.setLines(width => [fit(theme.fg('error', first), width)])
  } else {
    // Nothing to say: a box whose child renders no lines renders none either,
    // so a folded success adds no row to the panel.
    component.setLines(() => [])
  }

  return mount(box, component)
}

function fold(base: ToolDefinition): ToolDefinition {
  return {
    ...base,
    renderShell: 'self',
    renderCall: (args, theme, context) => renderCall(base.name, args, theme as RenderTheme, context),
    renderResult: (result, options, theme, context) =>
      renderResult(base, result, options, theme as RenderTheme, context)
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

const ON = 'Quiet tool rows are on: a collapsed call is one line, and its output waits for the expand key.'
const OFF = "Quiet tool rows are off: pi's own tool renderers are back."

export default function (pi: ExtensionAPI) {
  let quiet = true

  const register = (cwd: string) => {
    for (const tool of baseTools(cwd)) {
      pi.registerTool(quiet ? fold(tool) : tool)
    }
  }

  pi.on('session_start', (_event, ctx) => {
    register(ctx.cwd)
  })

  pi.on('session_shutdown', () => {
    for (const stop of [...armed]) {
      stop()
    }
  })

  pi.registerCommand('quiet-tools', {
    description: 'One-line collapsed tool rows, with the output hidden until expanded',
    getArgumentCompletions: prefix => {
      const query = prefix.trim().toLowerCase()
      const matches = ['on', 'off', 'toggle', 'status'].filter(action => action.startsWith(query))

      return matches.length > 0 ? matches.map(value => ({ label: value, value })) : null
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || 'toggle'

      if (action === 'status') {
        ctx.ui.notify(quiet ? ON : OFF, 'info')

        return
      }

      if (action !== 'on' && action !== 'off' && action !== 'toggle') {
        ctx.ui.notify('Usage: /quiet-tools on | off | toggle | status', 'warning')

        return
      }

      quiet = action === 'toggle' ? !quiet : action === 'on'
      register(ctx.cwd)
      ctx.ui.notify(quiet ? ON : OFF, 'info')
    }
  })
}
