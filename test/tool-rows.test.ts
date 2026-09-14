import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Marks every painted span, so a row reads back as what it is made of. */
const theme = {
  bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<b>${text}</b>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`
}

/** The same theme in real escapes, for the assertions that count columns. */
const plain = {
  bg: (_color: string, text: string) => `\x1b[48;5;22m${text}\x1b[49m`,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text
}

type Definition = {
  renderCall(args: unknown, theme: unknown, context: unknown): { render(width: number): string[] }
  renderResult(
    result: unknown,
    options: unknown,
    theme: unknown,
    context: unknown
  ): { render(width: number): string[] }
}

let tools: Map<string, { definition: Definition }>
let shutdown: (() => void)[]

beforeAll(async () => {
  // keyHint reads pi's live theme when it spells the expand key.
  initTheme('dark', false)

  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [join(root, 'src/tool-rows.ts')],
    agentDir: mkdtempSync(join(tmpdir(), 'pix-tools-')),
    cwd: root,
    noContextFiles: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true
  })

  await loader.reload()

  const { errors, extensions } = loader.getExtensions()

  expect(errors).toEqual([])

  const extension = extensions.find(candidate => basename(candidate.path) === 'tool-rows.ts')!

  for (const handler of extension.handlers.get('session_start') ?? []) {
    await handler({ type: 'session_start', reason: 'startup' } as never, {
      cwd: root,
      hasUI: true,
      ui: { notify: () => {} }
    } as never)
  }

  tools = extension.tools as unknown as Map<string, { definition: Definition }>
  shutdown = (extension.handlers.get('session_shutdown') ?? []).map(
    handler => () => void handler({ type: 'session_shutdown', reason: 'quit' } as never, {} as never)
  )
})

afterEach(() => {
  for (const stop of shutdown ?? []) {
    stop()
  }
})

interface RowOptions {
  argsComplete?: boolean
  executionStarted?: boolean
  expanded?: boolean
  isError?: boolean
  isPartial?: boolean
  paint?: typeof theme | typeof plain
  result?: unknown
  state?: Record<string, unknown>
  width?: number
}

/** One whole row: the call renderer reads state the result renderer writes, so
 *  both run before either is rendered, exactly as pi's panel does it. */
function row(name: string, args: unknown, options: RowOptions = {}) {
  const definition = tools.get(name)!.definition
  const finished = options.isPartial !== true && options.result !== undefined
  const state: Record<string, unknown> = options.state ?? (finished ? { endedAt: 1_200, startedAt: 0 } : {})
  const width = options.width ?? 200
  const paint = options.paint ?? theme
  const context = {
    args,
    argsComplete: options.argsComplete ?? true,
    cwd: root,
    executionStarted: options.executionStarted ?? true,
    expanded: options.expanded ?? false,
    invalidate: () => {},
    isError: options.isError ?? false,
    isPartial: options.isPartial ?? false,
    lastComponent: undefined,
    showImages: false,
    state,
    toolCallId: 'call-1'
  }
  const call = definition.renderCall(args, paint, { ...context, lastComponent: undefined })
  const result =
    options.result === undefined
      ? undefined
      : definition.renderResult(
          options.result,
          { expanded: context.expanded, isPartial: context.isPartial },
          paint,
          { ...context, lastComponent: undefined }
        )

  return { call: call.render(width), result: result?.render(width) ?? [], state }
}

/** A row as it reads: real escapes gone, the fake theme's markers gone, and
 *  the panel's one-column inset dropped so expectations start at the gutter. */
const text = (lines: string[]) =>
  lines.map(line =>
    stripTerminalSequences(line)
      .replace(/<\/?[A-Za-z]+>/g, '')
      .replace(/^ /, '')
      .trimEnd()
  )

it('draws a settled read as an icon, a verb and a target', () => {
  const { call, result } = row('read', { path: 'package.json' }, {
    result: { content: [{ text: 'a\nb\nc\n', type: 'text' }] }
  })

  expect(call).toHaveLength(1)
  expect(call[0]).toContain('<b><success>●</success></b>')
  expect(call[0]).toContain('<b><toolTitle>Read</toolTitle></b>')
  expect(call[0]).toContain('<accent>package.json</accent>')
  expect(text(result)).toEqual(['└ 3 lines loaded • ctrl+o to toggle'])
})

it('dims the icon while the arguments are still streaming', () => {
  const { call } = row('read', { path: 'a' }, { argsComplete: false, executionStarted: false })

  expect(call[0]).toContain('<b><dim>●</dim></b>')
})

it('spins while the call is in flight and stops when it settles', () => {
  const { call } = row('bash', { command: 'sleep 1' }, { isPartial: true, result: { content: [] } })

  expect(call[0]).toMatch(/<accent>[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]<\/accent>/)
})

it('marks a failure with the error colour', () => {
  const { call, result } = row('bash', { command: 'false' }, {
    isError: true,
    result: { content: [{ text: 'boom\n\nCommand exited with code 2', type: 'text' }] }
  })

  expect(call[0]).toContain('<b><error>●</error></b>')
  expect(text(result)[0]).toContain('└ Exit 2 (2 lines)')
})

it('flushes the bash trailer to the right edge', () => {
  const { call } = row('bash', { command: 'pytest -q' }, {
    paint: plain,
    result: { content: [{ text: 'a\nb\n', type: 'text' }] },
    width: 60
  })

  expect(visibleWidth(call[0]!)).toBe(60)
  expect(stripTerminalSequences(call[0]!).trimEnd().endsWith('2 lines · 1s')).toBe(true)
})

it('keeps a bash tail after the command finishes', () => {
  const { result } = row('bash', { command: 'make' }, {
    result: { content: [{ text: 'one\ntwo\nthree\n', type: 'text' }] }
  })

  expect(text(result)).toEqual(['└ Done (3 lines) • ctrl+o to toggle', '  one', '  two', '  three'])
})

it('shows what a running command has printed so far', () => {
  const { result } = row('bash', { command: 'make' }, {
    isPartial: true,
    result: { content: [{ text: Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n'), type: 'text' }] }
  })

  expect(text(result)[0]).toBe('└ ... (4 earlier lines)')
  expect(text(result).slice(1)).toEqual(['  line 4', '  line 5', '  line 6', '  line 7', '  line 8'])
})

it('summarises an edit with its counts, a meter and the first changed line', () => {
  const { result } = row('edit', { edits: [{}], path: 'a.ts' }, {
    paint: plain,
    result: {
      content: [{ text: 'Successfully replaced 1 block(s)', type: 'text' }],
      details: { firstChangedLine: 88, patch: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n+extra\n' }
    },
    width: 100
  })

  const line = text(result)[0]!

  expect(line).toContain('└ +2 -1 [')
  expect(line).toContain('] at line 88')
})

it('draws the Input and Output frame when expanded', () => {
  const { call, result } = row('read', { limit: 40, offset: 12, path: 'package.json' }, {
    expanded: true,
    result: { content: [{ text: 'one\ntwo\n', type: 'text' }] }
  })

  expect(call[0]).not.toContain('to toggle')

  const rows = text(result)

  expect(rows[0]).toBe('├ Input')
  expect(rows[1]).toBe('│ path: package.json')
  // path leads the human-first order; the rest fall back to alphabetical.
  expect(rows[2]).toBe('│ limit: 40')
  expect(rows[3]).toBe('│ offset: 12')
  expect(rows[4]).toBe('└ Output')
  expect(rows.slice(5).join('\n')).toContain('one')
})

it('caps the expanded input and says how much it left out', () => {
  const args = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, `v${i}`]))
  const { result } = row('read', args, { expanded: true, result: { content: [{ text: 'x', type: 'text' }] } })

  expect(text(result).filter(line => line.startsWith('│'))).toHaveLength(6)
  expect(text(result)[6]).toBe('│ … +4 more lines')
})

it('renders Output alone for a tool called with no arguments', () => {
  const { result } = row('ls', {}, { expanded: true, result: { content: [{ text: 'a\nb\n', type: 'text' }] } })

  expect(text(result)[0]).toBe('└ Output')
})

it('paints an expanded card and leaves a collapsed row transparent', () => {
  const collapsed = row('read', { path: 'a' }, { paint: plain, result: { content: [{ text: 'x', type: 'text' }] } })
  const opened = row('read', { path: 'a' }, {
    expanded: true,
    paint: plain,
    result: { content: [{ text: 'x', type: 'text' }] }
  })

  expect(collapsed.call[0]).not.toContain('\x1b[48;5;22m')
  expect(opened.call[0]!.startsWith('\x1b[48;5;22m')).toBe(true)
})

it('stops the shared spinner timer when the last pending row settles', () => {
  vi.useFakeTimers()

  try {
    const args = { command: 'sleep 1' }

    expect(vi.getTimerCount()).toBe(0)

    const state: Record<string, unknown> = {}

    row('bash', args, { isPartial: true, result: { content: [] }, state })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    // The same row again, now finished: the wheel and the clock both let go.
    row('bash', args, { result: { content: [{ text: 'done', type: 'text' }] }, state })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
