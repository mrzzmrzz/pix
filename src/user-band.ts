/**
 * Claude Code's user message band, by replacing pi's own renderer at runtime.
 *
 * Pi draws a user message as markdown inside a `Box` with a row of padding above
 * and below, so one line of text is three rows of colour and `**bold**` comes
 * back as bold. Claude Code draws a prompt glyph, the text exactly as it was
 * typed, and a tint running the full width for as many rows as the text
 * occupies. The OpenDDE Harness ported that shape; this ports it again onto pi.
 *
 * There is no extension point for this, so pix overrides `rebuild` on pi's
 * `UserMessageComponent`. That is a deliberate, documented intrusion, pinned to
 * the pi version in devDependencies and watched by CI. The class comes from the
 * package root, which is the one import that reaches pi's own instance in every
 * distribution: the npm install runs a bundle and serves extensions a virtual
 * module of it, the unbundled build aliases the root to its own `dist/index.js`,
 * and a file under `dist/` imported by path would be a second copy in the first
 * case, patched to no effect. Every step is guarded: if pi has moved the class
 * or its fields, the patch is skipped, pi keeps its own band, and the user is
 * told once.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import { UserMessageComponent, VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

/** The glyph in front of what was sent. */
const PROMPT = '❯'

/** Where the text starts: the glyph and the space after it. Wrapped lines are
 *  indented to the same column, so the message reads as one block rather than
 *  as a first line with a hanging remainder. */
const GUTTER = visibleWidth(PROMPT) + 1

/** Only the two calls the band makes, so pi's live theme satisfies it. */
interface BandTheme {
  bg(color: 'userMessageBg', text: string): string
  fg(color: 'userMessageText', text: string): string
}

/** What the patch needs of pi's component, and nothing more. */
interface UserMessageInstance {
  addChild(child: Component): void
  clear(): void
  outputPad?: unknown
  text?: unknown
}

class UserBand implements Component {
  private lines: string[] | undefined
  private lastWidth = -1

  constructor(
    private readonly theme: BandTheme,
    private readonly text: string,
    private readonly pad: number
  ) {}

  invalidate(): void {
    this.lines = undefined
  }

  render(width: number): string[] {
    if (this.lines !== undefined && this.lastWidth === width) {
      return this.lines
    }

    const inset = Math.min(Math.max(0, this.pad), Math.max(0, width - 1))
    const wrapped = wrapTextWithAnsi(this.text, Math.max(1, width - inset - GUTTER))
    const left = ' '.repeat(inset)

    this.lastWidth = width
    this.lines = wrapped.map((line, index) => {
      const head = index === 0 ? `${this.theme.fg('userMessageText', PROMPT)} ` : ' '.repeat(GUTTER)
      // Clipped before it is filled, so a terminal narrower than the glyph and
      // one character still gets a band that fits in it.
      const row = truncateToWidth(left + head + this.theme.fg('userMessageText', line), width, '')

      // Edge to edge: the tint is the full width of the terminal and the text
      // sits at the left of it.
      return this.theme.bg('userMessageBg', row + ' '.repeat(Math.max(0, width - visibleWidth(row))))
    })

    return this.lines
  }
}

/**
 * State shared between module copies. Jiti gives every load of this file a
 * fresh module, so a module-level flag would let a `/reload` patch the class
 * again; the slot lives on globalThis instead, the same trick pi uses to share
 * its theme between module copies.
 */
interface Shared {
  patched: boolean
  /** Pi's live theme, handed over at session_start. Before that the original
   *  renderer draws, which only a message rendered before any session could
   *  hit. */
  theme?: BandTheme
}

const SLOT = Symbol.for('pix:user-band')

function shared(): Shared {
  const slots = globalThis as unknown as Record<symbol, Shared | undefined>

  return (slots[SLOT] ??= { patched: false })
}

function applyPatch(state: Shared): boolean {
  try {
    const proto = (UserMessageComponent as unknown as { prototype?: Record<string, unknown> } | undefined)?.prototype
    const original = proto?.rebuild

    if (proto === undefined || typeof original !== 'function') {
      return false
    }

    const fallback = original as (this: UserMessageInstance) => void

    // Named, so a test can tell pix's frame from pi's by more than behaviour.
    proto.rebuild = function pixUserBandRebuild(this: UserMessageInstance) {
      // The fields are assigned before pi's constructor calls rebuild, so an
      // unexpected shape here means pi has changed: hand the frame back.
      if (typeof this.text !== 'string' || state.theme === undefined) {
        fallback.call(this)

        return
      }

      this.clear()
      this.addChild(new UserBand(state.theme, this.text, typeof this.outputPad === 'number' ? this.outputPad : 1))
    }

    return true
  } catch {
    return false
  }
}

export default function (pi: ExtensionAPI) {
  const state = shared()

  // In the factory, because pi runs it before the TUI mounts and so before any
  // user message is rendered.
  if (!state.patched) {
    state.patched = applyPatch(state)
  }

  let told = false

  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) {
      return
    }

    // The live theme: pi hands out the same object for the whole process and
    // switches its palette underneath, so holding it here follows `/theme`.
    state.theme = ctx.ui.theme

    if (!state.patched && !told) {
      told = true
      ctx.ui.notify(`pix: pi ${PI_VERSION} changed its user message component, band patch skipped`, 'warning')
    }
  })
}
