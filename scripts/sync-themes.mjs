// Refresh the vendored themes from pi-claude-theme's main branch. Vendored
// rather than depended on: npm 12 refuses git dependencies by default, and
// pi-claude-theme is not on npm.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/mrzzmrzz/pi-claude-theme/main/themes/'
const THEMES = ['claude-dark.json', 'claude-light.json']

for (const name of THEMES) {
  const response = await fetch(SOURCE + name)

  if (!response.ok) {
    throw new Error(`${SOURCE}${name}: ${response.status} ${response.statusText}`)
  }

  writeFileSync(fileURLToPath(new URL(`../themes/${name}`, import.meta.url)), await response.text())
  console.log(`themes/${name} synced`)
}
