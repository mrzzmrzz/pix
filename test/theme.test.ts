import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, getPackageDir } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** The directory the manifest hands pi: pi-claude-theme's two files, vendored. */
const themesDir = join(
  root,
  (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { pi: { themes: string[] } }).pi.themes[0]!
)

/** The tokens pi's own shipped schema marks required, rather than a copy of the
 *  list that would go stale the next time pi adds one. */
const requiredTokens = (
  JSON.parse(readFileSync(join(getPackageDir(), 'dist/modes/interactive/theme/theme-schema.json'), 'utf8')) as {
    properties: { colors: { required: string[] } }
  }
).properties.colors.required

it('ships the theme directory the manifest points at', () => {
  expect(existsSync(themesDir)).toBe(true)
  expect(readdirSync(themesDir).sort()).toEqual(['claude-dark.json', 'claude-light.json'])
})

it('loads both vendored themes through pi with no diagnostics', async () => {
  const loader = new DefaultResourceLoader({
    additionalThemePaths: [themesDir],
    agentDir: mkdtempSync(join(tmpdir(), 'pix-themes-')),
    cwd: root,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true
  })

  await loader.reload()

  const { diagnostics, themes } = loader.getThemes()

  expect(diagnostics).toEqual([])
  expect(themes.map(theme => theme.name).sort()).toEqual(['claude-dark', 'claude-light'])
})

it.each(['claude-dark.json', 'claude-light.json'])('%s defines every token pi requires', file => {
  const theme = JSON.parse(readFileSync(join(themesDir, file), 'utf8')) as { colors: Record<string, unknown> }

  expect(requiredTokens.filter(token => !(token in theme.colors))).toEqual([])
})
