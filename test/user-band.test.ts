import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { DefaultResourceLoader, getPackageDir, initTheme, UserMessageComponent } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { beforeAll, expect, it } from 'vitest'

const OSC133_ZONE_START = '\x1b]133;A\x07'
const root = fileURLToPath(new URL('..', import.meta.url))

type UserMessageClass = new (
  text: string,
  markdownTheme?: unknown,
  outputPad?: number,
  transformers?: readonly unknown[]
) => { render(width: number): string[] }

const Component = UserMessageComponent as unknown as UserMessageClass

beforeAll(async () => {
  initTheme('dark', false)

  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [join(root, 'src/user-band.ts')],
    agentDir: mkdtempSync(join(tmpdir(), 'pix-band-')),
    cwd: root,
    noContextFiles: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true
  })

  await loader.reload()

  const { errors, extensions } = loader.getExtensions()

  expect(errors).toEqual([])

  // The live theme pi would hand the extension at session_start. The singleton
  // is not on the package root, so the test reaches it the way pi's own
  // modules do.
  const { theme } = (await import(pathToFileURL(join(getPackageDir(), 'dist/modes/interactive/theme/theme.js')).href)) as {
    theme: unknown
  }
  const start = extensions[0]!.handlers.get('session_start')![0]! as (event: unknown, ctx: unknown) => unknown

  await start({ type: 'session_start', reason: 'startup' }, { hasUI: true, ui: { theme, notify: () => {} } })
})

it('patches the class pi itself renders', () => {
  // The test's own import and pi's alias for the extension both resolve to
  // the package's dist/index.js, so this prototype is the one pi renders with.
  const rebuild = (Component as unknown as { prototype: { rebuild: () => void } }).prototype.rebuild

  expect(rebuild.name).toBe('pixUserBandRebuild')
})

it('draws one tinted row per line of text and nothing else', () => {
  const lines = new Component('hello\nworld', undefined, 1, []).render(40)

  // Pi's own band is four rows here: a padding row, two lines, a padding row.
  expect(lines).toHaveLength(2)
  expect(lines[0]!.startsWith(OSC133_ZONE_START)).toBe(true)
  expect(lines.map(line => visibleWidth(line))).toEqual([40, 40])
  expect(lines.map(line => stripTerminalSequences(line).trimEnd())).toEqual([' ❯ hello', '   world'])
})

it('wraps onto the gutter rather than the margin', () => {
  const lines = new Component('aaaa bbbb cccc', undefined, 1, []).render(12)

  expect(lines.map(line => visibleWidth(line))).toEqual([12, 12])
  // One cell of outputPad, then the two the glyph and its space occupy.
  expect(lines.map(line => stripTerminalSequences(line).trimEnd())).toEqual([' ❯ aaaa bbbb', '   cccc'])
})

it('echoes markup literally instead of rendering it', () => {
  const lines = new Component('**bold**', undefined, 1, []).render(40)

  expect(stripTerminalSequences(lines[0]!).trimEnd()).toBe(' ❯ **bold**')
})
