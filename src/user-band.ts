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
 * private `UserMessageComponent`. That is a deliberate, documented intrusion,
 * pinned to the pi version in devDependencies and watched by CI. Every step is
 * guarded: if pi has moved the file, the class or the fields, the patch is
 * skipped, pi keeps its own band, and the user is told once.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPackageDir, VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

/** The glyph in front of what was sent. */
const PROMPT = '❯'

/** Where the text starts: the glyph and the space after it. Wrapped lines are
 *  indented to the same column, so the message reads as one block rather than
 *  as a first line with a hanging remainder. */
const GUTTER = visibleWidth(PROMPT) + 1

/** Only the two calls the band makes, so the live theme Proxy satisfies it. */
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

async function applyPatch(): Promise<boolean> {
  try {
    const dir = getPackageDir()
    // A plain `import()` of an absolute file URL. Jiti runs extensions in a vm
    // context, and it hands this specifier to Node rather than resolving it
    // itself, so the module here is the very one pi's interactive mode imported.
    // Forcing Node's loader with `new Function('s', 'return import(s)')` looks
    // safer and is not: jiti's context has no dynamic-import callback, so that
    // form throws and the patch would silently never apply.
    const load = (relative: string) =>
      import(pathToFileURL(join(dir, relative)).href) as Promise<Record<string, unknown>>
    const [component, palette] = await Promise.all([
      load('dist/modes/interactive/components/user-message.js'),
      load('dist/modes/interactive/theme/theme.js')
    ])

    const proto = (component.UserMessageComponent as { prototype?: Record<string, unknown> } | undefined)?.prototype
    // A Proxy that reads the live theme off globalThis, which pi does precisely
    // so a second module copy still sees the active palette. Only touched at
    // render time: reading a property before initTheme throws.
    const theme = palette.theme as BandTheme | undefined
    const original = proto?.rebuild

    if (proto === undefined || theme === undefined || typeof original !== 'function') {
      return false
    }

    const fallback = original as (this: UserMessageInstance) => void

    // Named, so a test can tell pix's frame from pi's by more than behaviour.
    proto.rebuild = function pixUserBandRebuild(this: UserMessageInstance) {
      // The fields are assigned before pi's constructor calls rebuild, so an
      // unexpected shape here means pi has changed: hand the frame back.
      if (typeof this.text !== 'string') {
        fallback.call(this)

        return
      }

      this.clear()
      this.addChild(new UserBand(theme, this.text, typeof this.outputPad === 'number' ? this.outputPad : 1))
    }

    return true
  } catch {
    return false
  }
}

/**
 * Applied once per process. Jiti gives every load of this file a fresh module,
 * so a module-level flag would let a `/reload` patch the class again; the guard
 * lives on globalThis instead, which is the same trick pi uses to share its
 * theme between module copies.
 */
const PATCH = Symbol.for('pix:user-band')

function patchOnce(): Promise<boolean> {
  const shared = globalThis as unknown as Record<symbol, Promise<boolean> | undefined>

  shared[PATCH] ??= applyPatch()

  return shared[PATCH]
}

export default async function (pi: ExtensionAPI) {
  // In the factory, because pi awaits it before the TUI mounts and so before
  // any user message is rendered.
  const patch = patchOnce()

  let told = false

  pi.on('session_start', async (_event, ctx) => {
    if (told || !ctx.hasUI || (await patch)) {
      return
    }

    told = true
    ctx.ui.notify(`pix: pi ${PI_VERSION} changed its user message component, band patch skipped`, 'warning')
  })

  await patch
}
