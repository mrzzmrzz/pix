import { sep } from 'node:path'

import { visibleWidth } from '@earendil-works/pi-tui'
import { expect, it } from 'vitest'

import {
  alignTrailing,
  branch,
  countPatch,
  displayPath,
  fit,
  formatElapsed,
  humanizeToolName,
  lineWindow,
  statBar,
  TRAILER,
  truncatePathToWidth
} from '../src/lib/rows.js'
import { collapsedSummary, inputRows, targetOf, verbFor } from '../src/lib/summary.js'
import { summarize } from '../src/lib/turn.js'

const cwd = `${sep}work${sep}repo`
const dim = (glyph: string) => `<${glyph}>`

it.each([
  ['read', undefined, 'Read'],
  ['bash', undefined, 'Bash'],
  ['ls', undefined, 'List'],
  ['write', undefined, 'Write'],
  ['edit', undefined, 'Edit'],
  ['web_fetch', undefined, 'Web Fetch'],
  ['taskList', 'Task List', 'Task List']
])('calls %s %s', (name, label, expected) => {
  expect(verbFor(name, label)).toBe(expected)
})

it('says Create only when the tool says the file was created', () => {
  expect(verbFor('write', undefined, 'Successfully wrote to /tmp/a')).toBe('Write')
  expect(verbFor('write', undefined, 'Created /tmp/a')).toBe('Create')
})

it.each([
  ['read', { path: `${cwd}${sep}src${sep}a.ts` }, 'src/a.ts'.replaceAll('/', sep), ''],
  ['read', { limit: 20, offset: 12, path: 'a.ts' }, 'a.ts', ' (offset=12, limit=20)'],
  ['bash', { command: 'pytest -q' }, 'pytest -q', ''],
  ['bash', { command: '#!/bin/sh\nmake -j8\ncheck' }, 'make -j8', ' · 3 lines'],
  ['grep', { path: 'src', pattern: 'TODO' }, '"TODO"', ' in src'],
  ['find', { pattern: '*.ts' }, '"*.ts"', ''],
  ['ls', {}, '.', ''],
  ['edit', { edits: [{}, {}], path: 'a.ts' }, 'a.ts', ' (2 edits)'],
  ['edit', { edits: [{}], path: 'a.ts' }, 'a.ts', ''],
  ['web_fetch', { url: 'https://example.com' }, 'https://example.com', '']
])('points a %s call at its subject', (name, args, text, detail) => {
  const target = targetOf(name, args, cwd)

  expect(target.text).toBe(text)
  expect(target.detail).toBe(detail)
})

it('relativises a path inside the working directory and keeps one outside it', () => {
  expect(displayPath(`${cwd}${sep}src${sep}a.ts`, cwd)).toBe(`src${sep}a.ts`)
  expect(displayPath(`${sep}etc${sep}hosts`, cwd)).toBe(`${sep}etc${sep}hosts`)
})

it('truncates a path in the middle and keeps the whole filename', () => {
  const path = 'packages/coding-agent/src/modes/interactive/components/tool-execution.ts'
  const cut = truncatePathToWidth(path, 40)

  expect(visibleWidth(cut)).toBeLessThanOrEqual(40)
  expect(cut.endsWith('/tool-execution.ts')).toBe(true)
  expect(cut).toContain('…')
})

it('cuts the filename itself only when nothing else will fit', () => {
  const cut = truncatePathToWidth('src/a-very-long-file-name-indeed.ts', 12)

  expect(visibleWidth(cut)).toBeLessThanOrEqual(12)
  expect(cut).toContain('…')
})

it('humanises a tool name', () => {
  expect(humanizeToolName('web_search')).toBe('Web Search')
  expect(humanizeToolName('applyPatch')).toBe('Apply Patch')
})

it('counts a unified patch', () => {
  const patch = ['--- a', '+++ b', '@@ -1,3 +1,4 @@', ' keep', '-gone', '+new', '+also', ' keep'].join('\n')

  expect(countPatch(patch)).toEqual({ added: 2, removed: 1 })
})

it('splits the change meter between added and removed', () => {
  expect(statBar(0, 0, 80)).toEqual({ add: 0, remove: 0 })
  expect(statBar(3, 1, 19)).toEqual({ add: 0, remove: 0 })

  const bar = statBar(3, 1, 140)

  expect(bar.add + bar.remove).toBe(10)
  expect(bar.add).toBeGreaterThan(bar.remove)
})

it.each([
  ['read', 'a\nb\n', { isError: false, lines: 412, truncated: false }, '412 lines loaded', ''],
  ['read', 'a\n', { isError: false, lines: 1, truncated: true }, '1 line loaded', ' (truncated)'],
  ['bash', 'a\nb\n', { isError: false, lines: 18, truncated: false }, 'Done', ''],
  ['grep', 'No matches found', { isError: false, lines: 1, truncated: false }, 'no matches', ''],
  ['grep', 'a.ts:1: x', { isError: false, lines: 7, truncated: false }, '7 matches', ''],
  ['find', '', { isError: false, lines: 0, truncated: false }, 'no files found', ''],
  ['ls', '(empty directory)', { isError: false, lines: 1, truncated: false }, 'empty directory', ''],
  ['write', 'Successfully wrote to a', { isError: false, lines: 3, truncated: false }, 'Wrote', ''],
  ['write', 'Created a', { isError: false, lines: 3, truncated: false }, 'Created', ''],
  ['mystery', 'x', { isError: false, lines: 4, truncated: false }, '4 lines returned', '']
])('summarises a collapsed %s result', (name, output, options, text, warn) => {
  const summary = collapsedSummary(name, output, options)

  expect(summary.text).toBe(text)
  expect(summary.warn).toBe(warn)
})

it('reports a failed command by its exit code', () => {
  const summary = collapsedSummary('bash', 'boom\n\nCommand exited with code 2', {
    isError: true,
    lines: 18,
    truncated: false
  })

  expect(summary).toMatchObject({ detail: ' (18 lines)', text: 'Exit 2', tone: 'error' })
})

it('reports any other failure by its first line', () => {
  expect(collapsedSummary('read', 'no such file\nstack', { isError: true, lines: 2, truncated: false })).toMatchObject({
    text: 'no such file',
    tone: 'error'
  })
})

it('closes a single result block and opens several', () => {
  expect(branch([['one']], 40, dim)).toEqual(['<└> one'])
  expect(branch([['one'], ['two']], 40, dim)).toEqual(['<├> one', '<└> two'])
})

it('keeps the gutter under a wrapped row', () => {
  const rows = branch([['aaaa bbbb cccc dddd'], ['tail']], 12, dim)

  expect(rows[0]).toBe('<├> aaaa bbbb')
  expect(rows[1]!.startsWith('<│> ')).toBe(true)
  expect(rows.at(-1)).toBe('<└> tail')
})

it('indents a closing block with spaces rather than a rule', () => {
  const rows = branch([['head', 'under']], 40, dim)

  expect(rows).toEqual(['<└> head', '  under'])
})

it.each([20, 40, 100])('flushes a trailer to the right edge at width %d', width => {
  const line = alignTrailing(`Bash pytest${TRAILER}37 lines · 12s`, width)

  expect(visibleWidth(line)).toBeLessThanOrEqual(width)
  expect(line.endsWith('37 lines · 12s')).toBe(true)
})

it('keeps the trailer and drops the head when the row is too narrow', () => {
  expect(alignTrailing(`a very long command indeed${TRAILER}9s`, 10)).toContain('9s')
})

it('keeps only the window it needs of a huge output', () => {
  const text = Array.from({ length: 100_000 }, (_, i) => `line ${i}`).join('\n')
  const tail = lineWindow(text, 5, 'tail')

  expect(tail.total).toBe(100_000)
  expect(tail.lines).toHaveLength(5)
  expect(tail.lines.at(-1)).toBe('line 99999')

  const head = lineWindow(text, 5, 'head')

  expect(head.lines).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4'])
  expect(head.total).toBe(100_000)
})

it('skips blank lines when it counts', () => {
  expect(lineWindow('a\n\n\nb\n', 5, 'tail')).toEqual({ lines: ['a', 'b'], total: 2 })
})

it('orders the expanded input by what a person reads first', () => {
  const rows = inputRows({ alpha: 1, command: 'ls', limit: 2, path: 'a.ts', zeta: 3 })

  expect(rows.map(row => row.key)).toEqual(['path', 'command', 'alpha', 'limit', 'zeta'])
  expect(rows[0]!.value).toBe('a.ts')
})

it.each([
  [{ calls: [{ name: 'bash' }, { name: 'bash' }], elapsedMs: 2_000 }, 'Ran 2 commands · 2s'],
  [
    { calls: [{ name: 'read', path: 'a.ts' }, { name: 'read', path: 'a.ts' }], elapsedMs: 1_000 },
    'Read 1 file · 1s'
  ],
  [
    {
      calls: [{ name: 'bash' }, { name: 'read', path: 'a.ts' }, { name: 'edit', path: 'b.ts' }, { name: 'web_fetch' }],
      elapsedMs: 72_000
    },
    'Ran 1 command, read 1 file, edited 1 file, 1 other call · 1m 12s'
  ]
])('says what a turn did', (work, expected) => {
  expect(summarize(work)).toBe(expected)
})

it('says nothing about a turn that ran no tools', () => {
  expect(summarize({ calls: [], elapsedMs: 1_000 })).toBe('')
})

it('keeps the panel background through a truncation', () => {
  const long = `\x1b[31m${'x'.repeat(50)}\x1b[39m`

  expect(fit(long, 12)).not.toContain('\x1b[0m')
  expect(fit(long, 12)).toContain('\x1b[39m\x1b[22m')
})

it('spells an elapsed time the way a person would', () => {
  expect(formatElapsed(900)).toBe('0s')
  expect(formatElapsed(12_000)).toBe('12s')
  expect(formatElapsed(72_000)).toBe('1m 12s')
  expect(formatElapsed(4_320_000)).toBe('1h 12m')
})
