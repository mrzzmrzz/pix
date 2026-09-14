import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Both extensions through pi's own loader. No model, no session, no
 *  credentials: loading is the whole claim. */
it('loads both extensions and they register their handlers', async () => {
  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [
      join(root, 'src/indicator.ts'),
      join(root, 'src/welcome.ts'),
      join(root, 'src/user-band.ts')
    ],
    agentDir: mkdtempSync(join(tmpdir(), 'pix-extensions-')),
    cwd: root,
    noContextFiles: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true
  })

  await loader.reload()

  const { errors, extensions } = loader.getExtensions()
  const handlers = (file: string) => [
    ...(extensions.find(extension => basename(extension.path) === file)?.handlers.keys() ?? [])
  ]

  expect(errors).toEqual([])
  expect(extensions.map(extension => basename(extension.path)).sort()).toEqual([
    'indicator.ts',
    'user-band.ts',
    'welcome.ts'
  ])
  // Handlers exist only if the factory ran, so this is also the smoke test for
  // everything the two modules import at load time.
  expect(handlers('indicator.ts')).toEqual(['agent_start', 'agent_end', 'session_shutdown'])
  expect(handlers('welcome.ts')).toEqual(['session_start', 'input', 'agent_start', 'session_shutdown'])
  expect(handlers('user-band.ts')).toEqual(['session_start'])
})
