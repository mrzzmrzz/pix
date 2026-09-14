import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AssistantMessageComponent, DefaultResourceLoader, initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { beforeAll, expect, it } from 'vitest'

import {
  estimateThought,
  formatThought,
  heading,
  previewLines,
  shimmer,
  shimmerWidth,
  shimmerWindow,
  summaryTitle
} from '../src/lib/thinking.js'

const root = fileURLToPath(new URL('..', import.meta.url))

it('lights a window that is a share of the heading, never all of it', () => {
  expect(shimmerWidth(4)).toBe(2)
  expect(shimmerWidth(1)).toBe(1)
  expect(shimmerWidth(100)).toBe(5)
})

it('walks the window across the heading and off both ends', () => {
  const length = 10
  const width = shimmerWidth(length)
  const seen = new Set<number>()

  for (let frame = 0; frame < length + width; frame++) {
    const { end, start } = shimmerWindow(length, frame)

    expect(end - start).toBe(width)

    for (let i = Math.max(0, start); i < Math.min(length, end); i++) {
      seen.add(i)
    }
  }

  // Every character is lit at some point in one pass, and the window starts
  // off the left so the line rests dark between passes.
  expect(seen.size).toBe(length)
  expect(shimmerWindow(length, 0).start).toBe(-width)
})

it('paints only the lit window differently', () => {
  const painted = shimmer('abcdef', 3, { lit: part => `[${part}]`, rest: part => part })

  expect(painted).toMatch(/^[a-f]*\[[a-f]+\][a-f]*$/)
  expect(painted.replace(/[[\]]/g, '')).toBe('abcdef')
})

it.each([
  [{ elapsedMs: 12_000, live: true }, 'Thinking… · 12s'],
  [{ elapsedMs: 12_000, live: false }, 'Thought for 12s'],
  [{ elapsedMs: 4_000, live: true, title: 'Checking the wire format' }, 'Checking the wire format · 4s'],
  [{ elapsedMs: 4_000, live: false, title: 'Checking the wire format' }, 'Checking the wire format · 4s'],
  [{ elapsedMs: 41_000, live: false }, 'Thought for 41s'],
  [{ elapsedMs: 200, live: false }, 'Thought for 1s']
])('words a heading', (options, expected) => {
  expect(heading(options)).toBe(expected)
})

it('never reports a thought as shorter than a second', () => {
  expect(formatThought(1)).toBe('1s')
  expect(formatThought(72_000)).toBe('1m 12s')
})

it('guesses a duration from how much was written', () => {
  expect(estimateThought(0)).toBe(1000)
  expect(estimateThought(1500)).toBe(10_000)
})

it('takes a title from a bold opening line', () => {
  expect(summaryTitle('**Checking the wire format**\nthen the rest')).toBe('Checking the wire format')
  expect(summaryTitle('no title here\n**not the first line**')).toBeUndefined()
})

it('takes a title from a reasoning summary signature', () => {
  const signature = JSON.stringify([
    { type: 'reasoning.encrypted', data: 'x' },
    { type: 'reasoning.summary', summary: 'Weighing two approaches\nmore text' }
  ])

  expect(summaryTitle('plain thinking', signature)).toBe('Weighing two approaches')
  expect(summaryTitle('plain thinking', 'not json')).toBeUndefined()
})

it('keeps the last rows of a thought, wrapped to the width', () => {
  const text = ['alpha bravo charlie delta', 'echo foxtrot', 'golf', 'hotel india'].join('\n')
  const rows = previewLines(text, 12, 3)

  expect(rows).toHaveLength(3)
  expect(rows.at(-1)).toBe('hotel india')
  expect(rows.every(row => row.length <= 12)).toBe(true)
})

// ------------------------------------------------------------------- patch

const message = (content: unknown[], timestamp = 1) => ({
  api: 'openai-completions',
  content,
  model: 'fake',
  provider: 'fake',
  role: 'assistant',
  stopReason: 'stop',
  timestamp,
  usage: {}
})

let handlers: Map<string, ((event: never, ctx: never) => unknown)[]>

beforeAll(async () => {
  initTheme('dark', false)

  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [join(root, 'src/thinking.ts')],
    agentDir: mkdtempSync(join(tmpdir(), 'pix-thinking-')),
    cwd: root,
    noContextFiles: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true
  })

  await loader.reload()

  const { errors, extensions } = loader.getExtensions()

  expect(errors).toEqual([])

  const extension = extensions.find(candidate => basename(candidate.path) === 'thinking.ts')!

  handlers = extension.handlers as Map<string, ((event: never, ctx: never) => unknown)[]>
})

/** Drive one of the extension's handlers with a fake context. */
async function fire(event: string, payload: unknown, entries: unknown[] = []): Promise<void> {
  for (const handler of handlers.get(event) ?? []) {
    await handler(payload as never, {
      cwd: root,
      hasUI: true,
      sessionManager: { getEntries: () => entries },
      ui: { notify: () => {}, theme: themeFor() }
    } as never)
  }
}

function themeFor() {
  return {
    bold: (t: string) => t,
    fg: (_c: string, t: string) => t,
    italic: (t: string) => t
  }
}

const rows = (component: { render(width: number): string[] }) =>
  component.render(60).map(line => stripTerminalSequences(line).trim()).filter(Boolean)

it('patches the class pi itself renders', async () => {
  await fire('session_start', { reason: 'startup', type: 'session_start' })

  const proto = (AssistantMessageComponent as unknown as { prototype: { updateContent: () => void } }).prototype

  expect(proto.updateContent.name).toBe('pixThinkingUpdateContent')
})

it("leaves pi's own rendering alone when thinking is shown", () => {
  const shown = new AssistantMessageComponent(
    message([{ thinking: 'weighing it up', type: 'thinking' }]) as never,
    false
  )

  // Pi's own expanded thinking is markdown of the thought itself.
  expect(rows(shown).join(' ')).toContain('weighing it up')
})

it('replaces the hidden placeholder with a settled thought', async () => {
  await fire('session_start', { reason: 'startup', type: 'session_start' })

  const hidden = new AssistantMessageComponent(
    message([{ thinking: 'weighing it up', type: 'thinking' }], 11) as never,
    true
  )

  expect(rows(hidden)).toEqual(['∴ Thought for 1s'])
})

it('counts a thought from its start and end events', async () => {
  await fire('session_start', { reason: 'startup', type: 'session_start' })
  await fire('message_update', {
    assistantMessageEvent: { type: 'thinking_start' },
    message: message([], 21),
    type: 'message_update'
  })

  const live = new AssistantMessageComponent(message([{ thinking: 'still going', type: 'thinking' }], 21) as never, true)

  expect(rows(live)[0]).toContain('Thinking…')
  expect(rows(live).length).toBeGreaterThan(1)

  await fire('message_update', {
    assistantMessageEvent: { type: 'thinking_end' },
    message: message([], 21),
    type: 'message_update'
  })

  const settled = new AssistantMessageComponent(
    message([{ thinking: 'still going', type: 'thinking' }], 21) as never,
    true
  )

  expect(rows(settled)).toEqual(['∴ Thought for 1s'])
})

it('freezes the clock on the first word of the answer', async () => {
  await fire('session_start', { reason: 'startup', type: 'session_start' })
  await fire('message_update', {
    assistantMessageEvent: { type: 'thinking_start' },
    message: message([], 31),
    type: 'message_update'
  })
  await fire('message_update', {
    assistantMessageEvent: { type: 'text_start' },
    message: message([], 31),
    type: 'message_update'
  })

  const settled = new AssistantMessageComponent(
    message([{ thinking: 'a thought', type: 'thinking' }], 31) as never,
    true
  )

  expect(rows(settled)).toEqual(['∴ Thought for 1s'])
})

it('freezes the clock at the end of the message when nothing else did', async () => {
  await fire('session_start', { reason: 'startup', type: 'session_start' })
  await fire('message_update', {
    assistantMessageEvent: { type: 'thinking_start' },
    message: message([], 41),
    type: 'message_update'
  })
  await fire('message_end', { message: message([], 41), type: 'message_end' })

  const settled = new AssistantMessageComponent(
    message([{ thinking: 'a thought', type: 'thinking' }], 41) as never,
    true
  )

  expect(rows(settled)).toEqual(['∴ Thought for 1s'])
})

it('restores durations recorded by an earlier run of the session', async () => {
  await fire('session_start', { reason: 'resume', type: 'session_start' }, [
    { customType: 'pix-thinking-duration', data: { elapsedMs: 41_000, timestamp: 51 }, type: 'custom' }
  ])

  const restored = new AssistantMessageComponent(
    message([{ thinking: 'a long thought', type: 'thinking' }], 51) as never,
    true
  )

  expect(rows(restored)).toEqual(['∴ Thought for 41s'])
})

it('adds up consecutive thinking-only messages and draws them once', async () => {
  await fire('session_start', { reason: 'resume', type: 'session_start' }, [
    { customType: 'pix-thinking-duration', data: { elapsedMs: 5_000, timestamp: 61 }, type: 'custom' },
    { customType: 'pix-thinking-duration', data: { elapsedMs: 7_000, timestamp: 62 }, type: 'custom' }
  ])

  const first = new AssistantMessageComponent(message([{ thinking: 'one', type: 'thinking' }], 61) as never, true)
  const second = new AssistantMessageComponent(message([{ thinking: 'two', type: 'thinking' }], 62) as never, true)

  expect(rows(second)).toEqual(['∴ Thought for 12s'])
  // The first has been taken over, so it says nothing. Pi's own blank spacer
  // row is still its own and stays.
  expect(rows(first)).toEqual([])
})

it('keeps a bold title out of the preview, since it is the heading', () => {
  expect(previewLines('**Checking the wire**\nfirst line\nsecond line', 80, 3)).toEqual(['first line', 'second line'])
})
