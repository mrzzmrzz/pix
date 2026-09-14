/**
 * The working row, as the OpenDDE Harness draws it:
 *
 *   (◔_◔) reading the diff… (12s · esc to interrupt)
 *
 * Pi owns that row. It renders one indicator frame verbatim, then a message it
 * paints muted itself, so the shimmer has to live entirely in the frames and
 * only the clock is left for the message. See `src/lib/frames.ts`.
 *
 * Every colour here is a theme token, so the row follows whatever theme is
 * active rather than carrying a palette of its own.
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { keyText } from '@earendil-works/pi-coding-agent'

import { FACES } from './lib/faces.js'
import { buildFrames } from './lib/frames.js'
import { pick, rotate } from './lib/pick.js'
import { formatElapsed, SHIMMER_MS } from './lib/shimmer.js'
import { VERBS } from './lib/verbs.js'

export default function (pi: ExtensionAPI) {
  let clock: NodeJS.Timeout | undefined
  /** Rotates the faces so two turns in a row do not open on the same one. */
  let turn = 0

  /** Give pi its row back. Idempotent: agent_end and session_shutdown both
   *  reach it, and a timer left running would hold the process open. */
  const rest = (ctx: ExtensionContext) => {
    clearInterval(clock)
    clock = undefined
    ctx.ui.setWorkingIndicator()
    ctx.ui.setWorkingMessage()
  }

  pi.on('agent_start', (_event, ctx) => {
    if (!ctx.hasUI) {
      return
    }

    const theme = ctx.ui.theme
    const base = (char: string) => theme.fg('accent', char)

    ctx.ui.setWorkingIndicator({
      frames: buildFrames({
        band: char => theme.bold(base(char)),
        base,
        faces: rotate(FACES, turn++),
        verb: pick(VERBS)
      }),
      intervalMs: SHIMMER_MS
    })

    const startedAt = Date.now()
    const showElapsed = () =>
      ctx.ui.setWorkingMessage(`(${formatElapsed((Date.now() - startedAt) / 1000)} · ${keyText('app.interrupt')} to interrupt)`)

    showElapsed()
    clearInterval(clock)
    clock = setInterval(showElapsed, 1000)
    clock.unref()
  })

  pi.on('agent_end', (_event, ctx) => rest(ctx))
  pi.on('session_shutdown', (_event, ctx) => rest(ctx))
}
