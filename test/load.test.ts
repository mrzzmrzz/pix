import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Every extension through pi's own loader. No model, no session, no
 *  credentials: loading is the whole claim. */
it('loads every extension and they register their handlers', async () => {
  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [
      join(root, 'src/indicator.ts'),
      join(root, 'src/user-band.ts'),
      join(root, 'src/tool-rows.ts'),
      join(root, 'src/turn-summary.ts')
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
    'tool-rows.ts',
    'turn-summary.ts',
    'user-band.ts'
  ])
  // Handlers exist only if the factory ran, so this is also the smoke test for
  // everything the three modules import at load time.
  expect(handlers('indicator.ts')).toEqual(['session_start', 'agent_start', 'agent_end', 'session_shutdown'])
  expect(handlers('user-band.ts')).toEqual(['session_start'])
  expect(handlers('tool-rows.ts')).toEqual([
    'session_start',
    'message_update',
    'tool_execution_start',
    'session_shutdown'
  ])
  expect(handlers('turn-summary.ts')).toEqual([
    'agent_start',
    'tool_execution_start',
    'tool_execution_end',
    'agent_end'
  ])
})
