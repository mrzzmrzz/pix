/**
 * Thinking blocks, collapsed the way Claude Code collapses them.
 *
 * While the model is thinking:
 *
 *   Thinking… · 4s
 *   …the last three lines of what it is saying
 *
 * and once it stops, one line: ` ∴ Thought for 4s`. The heading shimmers while
 * the thought is live, which is the only thing on screen saying the model is
 * still there.
 *
 * This replaces `AssistantMessageComponent.updateContent` on pi's own class, as
 * `src/user-band.ts` replaces the user band, and for the same reason: there is
 * no extension point for it. The intrusion is kept narrow. Pi builds the
 * message exactly as it always does, and only the placeholder it drew for a
 * hidden thought is swapped for ours. With thinking shown rather than hidden,
 * pi's own rendering is handed back untouched.
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { Component, MouseRegionHandler } from '@earendil-works/pi-tui'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AssistantMessageComponent, getAgentDir, SettingsManager, VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent'
import { MouseRegion, visibleWidth } from '@earendil-works/pi-tui'

import type { Theme } from '@earendil-works/pi-coding-agent'

import { estimateThought, heading, MARKER, previewLines, shimmer, SHIMMER_MS, summaryTitle } from './lib/thinking.js'

/** Lines of the live thought kept under its heading. */
const PREVIEW_LINES = 3

const ENTRY = 'pix-thinking-duration'

interface ThinkingRun {
  signature?: string | undefined
  text: string
}

/** Only what a thought paints. */
type ThinkingTheme = Pick<Theme, 'bold' | 'fg' | 'italic'>

// ------------------------------------------------------------------ clocks

/** How long each message spent thinking, by message timestamp: stable across a
 *  render, a rebuild and a resume. */
const finished = new Map<number, number>()
const open = new Map<number, number>()

function startedThinking(timestamp: number): void {
  if (!finished.has(timestamp) && !open.has(timestamp)) {
    open.set(timestamp, Date.now())
  }
}

/** Freeze the clock. Several providers never send `thinking_end`, so the first
 *  word of text or the first tool call is taken as the end of the thought. */
function stoppedThinking(timestamp: number): number | undefined {
  const startedAt = open.get(timestamp)

  if (startedAt === undefined) {
    return undefined
  }

  open.delete(timestamp)

  const elapsed = Date.now() - startedAt

  finished.set(timestamp, elapsed)

  return elapsed
}

/** What a thought took, whatever the provider was willing to say about it. */
export function elapsedOf(timestamp: number, runs: readonly ThinkingRun[]): number {
  const done = finished.get(timestamp)

  if (done !== undefined) {
    return done
  }

  const startedAt = open.get(timestamp)

  if (startedAt !== undefined) {
    return Date.now() - startedAt
  }

  // A provider that never timed its thinking still wrote it down.
  return estimateThought(runs.reduce((sum, run) => sum + run.text.length, 0))
}

function timestampOf(message: AgentMessage): number {
  const value = (message as { timestamp?: unknown }).timestamp

  return typeof value === 'number' ? value : 0
}

// ---------------------------------------------------------------- shimmer

/** Every live heading. One timer for all of them, stopped the moment the last
 *  thought settles: nothing of pix's may hold the process open. */
const live = new Set<Thought>()
let wheel: NodeJS.Timeout | undefined
let frame = 0

function shimmerOn(): void {
  if (wheel !== undefined) {
    return
  }

  wheel = setInterval(() => {
    frame++

    for (const thought of [...live]) {
      thought.repaint()
    }

    if (live.size === 0) {
      shimmerOff()
    }
  }, SHIMMER_MS)
  wheel.unref()
}

function shimmerOff(): void {
  clearInterval(wheel)
  wheel = undefined
}

// ------------------------------------------------------------------ merging

/**
 * Thinking-only messages that follow one another are one thought.
 *
 * A model that pauses to think three times in a row with nothing between has
 * thought once, for the sum of the three. Rather than move pi's children about,
 * each block asks the chain at render time whether a later one has absorbed it
 * and draws nothing if so.
 */
interface Link {
  elapsedMs: number
  next?: Link | undefined
  previous?: Link | undefined
  thinkingOnly: boolean
}

/** Keyed by message timestamp, not by the message object: pi hands
 *  `updateContent` a fresh object for every streamed delta, and one link per
 *  delta would add the same thought up dozens of times. */
const links = new Map<number, Link>()
let tail: Link | undefined

function chain(timestamp: number, thinkingOnly: boolean, elapsedMs: number): Link {
  let link = links.get(timestamp)

  if (link === undefined) {
    link = { elapsedMs, thinkingOnly }
    links.set(timestamp, link)
  }

  link.elapsedMs = elapsedMs
  link.thinkingOnly = thinkingOnly

  if (thinkingOnly) {
    if (tail !== undefined && tail !== link && tail.thinkingOnly && link.previous === undefined) {
      link.previous = tail
      tail.next = link
    }

    tail = link
  } else {
    // The message grew text or a tool call, so it no longer joins anything.
    if (link.previous?.next === link) {
      link.previous.next = undefined
    }

    link.previous = undefined
    tail = undefined
  }

  return link
}

/** Whether a later thought has taken this one over. */
function absorbed(link: Link): boolean {
  return link.next !== undefined && link.next.thinkingOnly && link.thinkingOnly
}

/** This thought and every one it absorbed, added up. */
function total(link: Link, own: number): number {
  let sum = own

  for (let step: Link | undefined = link.previous; step !== undefined; step = step.previous) {
    sum += step.elapsedMs
  }

  return sum
}

// ---------------------------------------------------------------- component

class Thought implements Component {
  private cache: string[] | undefined
  private lastWidth = -1
  private link: Link | undefined
  private painted = false
  private runs: readonly ThinkingRun[] = []
  private timestamp = 0

  constructor(
    private readonly theme: ThinkingTheme,
    private readonly pad: number
  ) {}

  update(options: { link: Link; runs: readonly ThinkingRun[]; timestamp: number }): void {
    this.link = options.link
    this.runs = options.runs
    this.timestamp = options.timestamp
    this.cache = undefined

    if (open.has(this.timestamp)) {
      live.add(this)
      shimmerOn()
    }
  }

  /** The shimmer moved; the rows have to be built again. */
  repaint(): void {
    this.cache = undefined
  }

  invalidate(): void {
    this.cache = undefined
  }

  render(width: number): string[] {
    if (this.link !== undefined && absorbed(this.link)) {
      return []
    }

    // Liveness is decided here rather than when the row was built, because a
    // thought can end on an event that never rebuilds the message.
    const isLive = open.has(this.timestamp)

    if (isLive !== this.painted) {
      this.painted = isLive
      this.cache = undefined

      if (!isLive) {
        live.delete(this)

        if (live.size === 0) {
          shimmerOff()
        }
      }
    }

    if (this.cache !== undefined && this.lastWidth === width) {
      return this.cache
    }

    this.lastWidth = width
    this.cache = this.build(width, isLive)

    return this.cache
  }

  private build(width: number, isLive: boolean): string[] {
    const theme = this.theme
    const left = ' '.repeat(this.pad)
    const text = this.runs.map(run => run.text).join('\n\n')
    const title = summaryTitle(text, this.runs.find(run => run.signature)?.signature)
    const own = elapsedOf(this.timestamp, this.runs)
    const elapsedMs = this.link === undefined ? own : total(this.link, own)
    const line = heading({ elapsedMs, live: isLive, ...(title === undefined ? {} : { title }) })

    if (!isLive) {
      return [left + theme.fg('thinkingText', `${MARKER} ${line}`)]
    }

    const rows = [
      left +
        shimmer(line, frame, {
          lit: part => theme.italic(theme.bold(theme.fg('text', part))),
          rest: part => theme.italic(theme.fg('thinkingText', part))
        })
    ]

    for (const row of previewLines(text, Math.max(1, width - this.pad), PREVIEW_LINES)) {
      rows.push(left + theme.italic(theme.fg('thinkingText', row)))
    }

    return rows
  }
}

// -------------------------------------------------------------------- patch

/** The consecutive thinking blocks of a message, as pi groups them. */
function thinkingRuns(message: AgentMessage): ThinkingRun[][] {
  const runs: ThinkingRun[][] = []
  const content = (message as { content?: unknown }).content

  if (!Array.isArray(content)) {
    return runs
  }

  let current: ThinkingRun[] | undefined

  for (const block of content) {
    const record = block && typeof block === 'object' ? (block as Record<string, unknown>) : {}

    if (record.type === 'thinking' && typeof record.thinking === 'string' && record.thinking.trim()) {
      current ??= []
      current.push({
        signature: typeof record.thinkingSignature === 'string' ? record.thinkingSignature : undefined,
        text: record.thinking.trim()
      })
    } else if (record.type !== 'thinking') {
      if (current) {
        runs.push(current)
      }

      current = undefined
    }
  }

  if (current) {
    runs.push(current)
  }

  return runs
}

function hasTextOrTools(message: AgentMessage): boolean {
  const content = (message as { content?: unknown }).content

  return (
    Array.isArray(content) &&
    content.some(block => {
      const record = block && typeof block === 'object' ? (block as Record<string, unknown>) : {}

      return record.type === 'toolCall' || (record.type === 'text' && String(record.text ?? '').trim())
    })
  )
}

/** What pix needs of pi's component, and nothing more. */
interface MessageComponent {
  contentContainer?: { children?: unknown[] }
  hideThinkingBlock?: unknown
  outputPad?: unknown
  thinkingVisibilityOverrides?: Map<number, boolean>
}

/** One component per run per message, kept so the shimmer runs on rather than
 *  restarting with every streamed delta. Keyed by timestamp for the same reason
 *  the chain is. */
const thoughts = new Map<number, Thought[]>()

function decorate(component: MessageComponent, message: AgentMessage, theme: ThinkingTheme): void {
  const children = component.contentContainer?.children

  if (!Array.isArray(children)) {
    return
  }

  const runs = thinkingRuns(message)
  const slots: number[] = []

  children.forEach((child, index) => {
    if (child instanceof MouseRegion) {
      slots.push(index)
    }
  })

  // Pi wraps exactly one MouseRegion around each thinking run. A different
  // count means pi has changed shape, and pix leaves the message alone.
  if (slots.length !== runs.length || runs.length === 0) {
    return
  }

  const pad = typeof component.outputPad === 'number' ? component.outputPad : 1
  const timestamp = timestampOf(message)
  const held = thoughts.get(timestamp) ?? []
  const link = chain(timestamp, !hasTextOrTools(message), elapsedOf(timestamp, runs.flat()))

  thoughts.set(timestamp, held)

  slots.forEach((index, run) => {
    if (component.thinkingVisibilityOverrides?.get(run) === false) {
      // The reader asked for this one in full; pi's own rendering stands.
      return
    }

    const thought = (held[run] ??= new Thought(theme, pad))

    // Only the run still being written can be live; an earlier run of the same
    // message is settled whatever the clock says.
    thought.update({ link, runs: runs[run]!, timestamp: run === runs.length - 1 ? timestamp : -1 })

    // Pi's own click-to-reveal handler is kept, so clicking a thought still
    // opens it; only what is drawn under the mouse changes.
    const region = children[index] as unknown as { onMouse: MouseRegionHandler }

    children[index] = new MouseRegion(thought, region.onMouse)
  })
}

/**
 * Applied once per process. Jiti gives every load of this file a fresh module,
 * so a module-level flag would let a `/reload` patch the class again; the guard
 * lives on globalThis, which is the same trick pi uses to share its theme.
 */
const PATCH = Symbol.for('pix:thinking')

/** Set once a session is running. Until then pix has no palette to paint with
 *  and leaves pi's own placeholder alone. */
let palette: ThinkingTheme | undefined

function patchOnce(): boolean {
  const shared = globalThis as unknown as Record<symbol, boolean | undefined>

  if (shared[PATCH] !== undefined) {
    return shared[PATCH]
  }

  shared[PATCH] = false

  try {
    const proto = (AssistantMessageComponent as unknown as { prototype?: Record<string, unknown> } | undefined)
      ?.prototype
    const original = proto?.updateContent

    if (proto === undefined || typeof original !== 'function') {
      return false
    }

    const build = original as (this: MessageComponent, message: AgentMessage, isStreaming?: boolean) => void

    proto.updateContent = function pixThinkingUpdateContent(
      this: MessageComponent,
      message: AgentMessage,
      isStreaming?: boolean
    ) {
      build.call(this, message, isStreaming)

      // Thinking shown rather than hidden is pi's own view, and pix stays out
      // of it. The README asks for `hideThinkingBlock`.
      if (this.hideThinkingBlock !== true) {
        return
      }

      if (palette === undefined) {
        return
      }

      try {
        decorate(this, message, palette)
      } catch {
        // Whatever pi drew stands. A thought is not worth a broken transcript.
      }
    }

    shared[PATCH] = true

    return true
  } catch {
    return false
  }
}

/**
 * Pi's own switch is what pix rides: thinking hidden means pix's collapsed
 * view, thinking shown means pi's full text, and the toggle key moves between
 * them. A user who never chose gets it chosen once, in their settings file, so
 * every later start opens collapsed; a value they set themselves is never
 * touched. Pi read its copy before pix loaded, so the first session needs the
 * toggle key or a restart, and session_start says so.
 */
export async function adoptHiddenThinking(agentDir = getAgentDir(), cwd = process.cwd()): Promise<boolean> {
  try {
    const file = join(agentDir, 'settings.json')
    const raw: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}

    if (raw && typeof raw === 'object' && 'hideThinkingBlock' in raw) {
      return false
    }

    const settings = SettingsManager.create(cwd, agentDir)

    settings.setHideThinkingBlock(true)
    // Saves are queued; the file is the whole point, so wait for it.
    await settings.flush()

    return true
  } catch {
    // A settings file pix cannot read is not pix's to write.
    return false
  }
}

export default async function (pi: ExtensionAPI) {
  // In the factory, because pi awaits it before the TUI mounts and so before
  // any message is rendered.
  const applied = patchOnce()
  const adopted = applied && (await adoptHiddenThinking())
  let told = false

  // Entries are how a duration survives a resume. They render nothing: the
  // thought itself is drawn by the message above them.
  pi.registerEntryRenderer<{ elapsedMs: number; timestamp: number }>(ENTRY, () => undefined)

  pi.on('session_start', (_event, ctx) => {
    palette = ctx.ui.theme
    // A new transcript starts a new run of thoughts; nothing before it merges.
    links.clear()
    thoughts.clear()
    tail = undefined
    restore(ctx)

    if (told || !ctx.hasUI) {
      return
    }

    told = true

    if (!applied) {
      ctx.ui.notify(`pix: pi ${PI_VERSION} changed its assistant message component, thoughts left as they are`, 'warning')
    } else if (adopted) {
      ctx.ui.notify('pix: thinking blocks now collapse. Press ctrl+t once to collapse them in this session.', 'info')
    }
  })

  pi.on('message_update', (event, ctx) => {
    const timestamp = timestampOf(event.message)
    const type = (event.assistantMessageEvent as { type?: string } | undefined)?.type

    if (type === 'thinking_start') {
      startedThinking(timestamp)

      return
    }

    // Several providers never send `thinking_end`, so the first word of the
    // answer, or the first tool call, is taken as the end of the thought.
    if (
      type === 'thinking_end' ||
      type === 'text_start' ||
      type === 'text_delta' ||
      type === 'toolcall_start' ||
      type === 'toolcall_end'
    ) {
      record(pi, ctx, timestamp)
    }
  })

  pi.on('message_end', (event, ctx) => {
    record(pi, ctx, timestampOf(event.message))
  })

  pi.on('session_shutdown', () => {
    live.clear()
    shimmerOff()
  })
}

function record(pi: ExtensionAPI, _ctx: ExtensionContext, timestamp: number): void {
  const elapsedMs = stoppedThinking(timestamp)

  if (elapsedMs === undefined) {
    return
  }

  try {
    pi.appendEntry(ENTRY, { elapsedMs, timestamp })
  } catch {
    // Outside a running session there is nothing to append to, and a thought
    // that is not persisted is still a thought.
  }
}

/** Durations from an earlier run of this session, so a resumed transcript says
 *  what it said before rather than guessing again. */
function restore(ctx: ExtensionContext): void {
  try {
    for (const entry of ctx.sessionManager.getEntries()) {
      const custom = entry as { customType?: unknown; data?: unknown }

      if (custom.customType !== ENTRY) {
        continue
      }

      const data = custom.data as { elapsedMs?: unknown; timestamp?: unknown } | undefined

      if (typeof data?.elapsedMs === 'number' && typeof data.timestamp === 'number') {
        finished.set(data.timestamp, data.elapsedMs)
      }
    }
  } catch {
    // A session that cannot be read is one with nothing to restore.
  }
}
