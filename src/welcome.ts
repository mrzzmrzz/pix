/**
 * The mark the first screen opens with: PIX in block letters, the name and
 * version, and one line of pi's own key hints.
 *
 * One colour, like Claude Code's own logo, and it is the theme's accent: pix
 * carries no palette of its own. It is a greeting, so it lives above the editor
 * until the session is used and then goes. Pi's own startup header is left
 * alone; the README asks for `quietStartup` if you would rather have only this
 * one.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

import { keyText } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { renderWord, scaleArt } from './lib/glyphs.js'
import { VERSION } from './lib/version.js'

const WIDGET = 'pix-welcome'

function artWidth(rows: readonly string[]): number {
  return rows.reduce((width, row) => Math.max(width, visibleWidth(row)), 0)
}

class WelcomeMark implements Component {
  private lines: string[] | undefined
  private lastWidth = -1

  constructor(private readonly theme: Theme) {}

  invalidate(): void {
    this.lines = undefined
  }

  render(width: number): string[] {
    if (this.lines === undefined || this.lastWidth !== width) {
      this.lastWidth = width
      this.lines = [...this.art(width), this.nameLine(), this.hintLine(), ''].map(line =>
        truncateToWidth(line, width)
      )
    }

    return this.lines
  }

  /** The wordmark, full size where it fits and halved where it does not. Below
   *  that there is no drawing worth keeping, and the name line carries the
   *  brand at every width anyway. */
  private art(width: number): string[] {
    const full = renderWord('PIX')
    const rows = artWidth(full) <= width ? full : scaleArt(full, 2)

    if (artWidth(rows) > width) {
      return []
    }

    return rows.map(row => (row === '' ? row : this.theme.fg('accent', row)))
  }

  /** `ϒ  pix v0.1.0`. */
  private nameLine(): string {
    return this.theme.bold(this.theme.fg('accent', `ϒ  pix v${VERSION}`))
  }

  /** Pi's own wording for its own keys, in the theme's muted colour. */
  private hintLine(): string {
    const exit = keyText('app.clear') || 'ctrl+c'

    return this.theme.fg('muted', `/ for commands · ${exit} twice to exit`)
  }
}

export default function (pi: ExtensionAPI) {
  const clear = (ctx: ExtensionContext) => {
    ctx.ui.setWidget(WIDGET, undefined)
  }

  pi.on('session_start', (event, ctx) => {
    if (ctx.hasUI && (event.reason === 'startup' || event.reason === 'new')) {
      ctx.ui.setWidget(WIDGET, (_tui, theme) => new WelcomeMark(theme))
    }
  })

  // A greeting outstays its welcome the moment the session is used. `input`
  // covers a slash command or a bash line, neither of which starts an agent.
  pi.on('input', (_event, ctx) => {
    clear(ctx)
  })
  pi.on('agent_start', (_event, ctx) => {
    clear(ctx)
  })
  pi.on('session_shutdown', (_event, ctx) => {
    clear(ctx)
  })
}
