import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, initTheme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { beforeAll, expect, it } from 'vitest'

import { composeRow, fit, invocationSummary } from '../src/lib/rows.js'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Marks every painted span, so a row reads back as what it is made of. */
const theme = {
  bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<b>${text}</b>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`
}

/** The same theme in real escapes, for the assertions that count columns: the
 *  markers above would be counted as visible text. */
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

  // The tools are registered by the session_start handler, so drive it.
  for (const handler of extension.handlers.get('session_start') ?? []) {
    await handler({ type: 'session_start', reason: 'startup' } as never, {
      cwd: root,
      hasUI: true,
      ui: { notify: () => {} }
    } as never)
  }

  tools = extension.tools as unknown as Map<string, { definition: Definition }>
})

/** One whole row: the call renderer reads state the result renderer writes, so
 *  both run before either is rendered, exactly as pi's panel does it. */
function row(
  name: string,
  args: unknown,
  options: {
    expanded?: boolean
    isError?: boolean
    isPartial?: boolean
    paint?: typeof theme | typeof plain
    result?: unknown
    width?: number
  } = {}
) {
  const definition = tools.get(name)!.definition
  // A finished row has both ends of its clock; a running one has only a start.
  const state: Record<string, unknown> = options.isPartial ? { startedAt: 0 } : { endedAt: 1_200, startedAt: 0 }
  // Wide enough that nothing truncates: the theme markers below count as
  // visible columns, and truncation has its own tests.
  const width = options.width ?? 200
  const context = {
    args,
    argsComplete: true,
    cwd: root,
    executionStarted: true,
    expanded: options.expanded ?? false,
    invalidate: () => {},
    isError: options.isError ?? false,
    isPartial: options.isPartial ?? false,
    lastComponent: undefined,
    showImages: false,
    state,
    toolCallId: 'call-1'
  }
  const paint = options.paint ?? theme
  // Both slots run before either is rendered, exactly as pi's panel does it, and
  // each keeps its own `lastComponent`.
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

  return { call: call.render(width), result: result?.render(width) ?? [] }
}

it.each([
  ['bash', { command: 'pwd' }, 'pwd'],
  ['read', { path: 'src/a.ts' }, 'src/a.ts'],
  ['read', { offset: 40, path: 'src/a.ts' }, 'src/a.ts:40'],
  ['edit', { edits: [{}], path: 'src/a.ts' }, 'src/a.ts (1 edit)'],
  ['edit', { edits: [{}, {}], path: 'src/a.ts' }, 'src/a.ts (2 edits)'],
  ['write', { file_path: '/tmp/x' }, '/tmp/x'],
  ['ls', {}, ''],
  ['ls', { limit: 5 }, '.'],
  ['grep', { pattern: 'TODO' }, 'TODO in .'],
  ['find', { path: 'src', pattern: '*.ts' }, '*.ts in src'],
  ['web_fetch', { limit: 3, url: 'https://example.com' }, 'https://example.com'],
  ['mystery', { count: 7 }, 'count=7']
])('summarises a %s call', (name, args, expected) => {
  expect(invocationSummary(name, args)).toBe(expected)
})

it('collapses whitespace and strips what a tool wrote', () => {
  expect(invocationSummary('bash', { command: 'echo \x1b[31mhi\x1b[0m\n  there' })).toBe('echo hi there')
})

it('keeps the panel background through a truncation', () => {
  const long = `\x1b[31m${'x'.repeat(50)}\x1b[39m`

  expect(truncateToWidth(long, 12, '...')).toContain('\x1b[0m')
  expect(fit(long, 12)).not.toContain('\x1b[0m')
  expect(fit(long, 12)).toContain('\x1b[39m\x1b[22m')
})

it('keeps the suffix whole and cuts the invocation instead', () => {
  const composed = composeRow('x'.repeat(40), '(hint)', 30)

  expect(composed.endsWith(' (hint)')).toBe(true)
  expect(composed).toContain('...')
})

it('drops the suffix when the row is too narrow to say anything else', () => {
  expect(composeRow('x'.repeat(40), '(hint)', 12)).not.toContain('(hint)')
})

it('folds a finished call into one line with the expand hint', () => {
  const { call, result } = row('bash', { command: 'pwd' }, { result: { content: [{ text: 'ok', type: 'text' }] } })

  expect(call).toHaveLength(1)
  expect(call[0]).toContain('<b><text>bash</text></b>')
  expect(call[0]).toContain('<muted>pwd</muted>')
  expect(call[0]).toContain('<muted> 1.2s</muted>')
  expect(call[0]).toContain('to expand')
  // A successful folded call shows nothing of what it returned.
  expect(result).toEqual([])
})

it('drops the expand hint when the row is expanded', () => {
  const { call } = row('bash', { command: 'pwd' }, { expanded: true, result: { content: [] } })

  expect(call).toHaveLength(1)
  expect(call[0]).not.toContain('to expand')
})

it('keeps the first line of a failure under the header', () => {
  const { result } = row('bash', { command: 'false' }, {
    isError: true,
    result: { content: [{ text: 'boom: no such thing\nstack frame\n', type: 'text' }] }
  })

  expect(result).toEqual([expect.stringContaining('<error>boom: no such thing</error>')])
})

it('says [no output] when a failure said nothing at all', () => {
  const { result } = row('bash', { command: 'false' }, { isError: true, result: { content: [] } })

  expect(result).toEqual([expect.stringContaining('<error>[no output]</error>')])
})

it('shows the last line of a running call as progress', () => {
  const { call } = row('bash', { command: 'make' }, {
    isPartial: true,
    result: { content: [{ text: 'compiling a\ncompiling b\n', type: 'text' }] }
  })

  expect(call).toHaveLength(2)
  expect(call[1]).toContain('<muted>compiling b</muted>')
  // Nothing is over yet, so the row does not offer to expand.
  expect(call[0]).not.toContain('to expand')
})

it('tints exactly the rows it fills, edge to edge', () => {
  const { call, result } = row('bash', { command: 'pwd' }, {
    paint: plain,
    result: { content: [{ text: 'ok', type: 'text' }] },
    width: 40
  })

  // Pi's own shell pads a row above and below; this panel is its content.
  expect(call).toHaveLength(1)
  expect(result).toEqual([])
  expect(call[0]!.startsWith('\x1b[48;5;22m')).toBe(true)
  expect(visibleWidth(call[0]!)).toBe(40)
})

it('tints the header and the expanded result alike', () => {
  const { call, result } = row('bash', { command: 'pwd' }, {
    expanded: true,
    paint: plain,
    result: { content: [{ text: '/tmp/x', type: 'text' }], details: {} },
    width: 40
  })

  expect(call).toHaveLength(1)
  expect(result.length).toBeGreaterThan(0)
  // One panel, not two: every row of it carries the same background.
  for (const line of [...call, ...result]) {
    expect(line.startsWith('\x1b[48;5;22m')).toBe(true)
    expect(visibleWidth(line)).toBe(40)
  }
})

it('gives a failure two rows and no more', () => {
  const { call, result } = row('bash', { command: 'false' }, {
    isError: true,
    paint: plain,
    result: { content: [{ text: 'boom', type: 'text' }] },
    width: 40
  })

  expect([...call, ...result]).toHaveLength(2)
  expect(visibleWidth(result[0]!)).toBe(40)
})
