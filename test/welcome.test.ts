import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { BLOCK_GLYPHS, renderWord, scaleArt } from '../src/lib/glyphs.js'
import { VERSION } from '../src/lib/version.js'

it('draws a word as seven rows of blocks and a blank', () => {
  const rows = renderWord('PIX')

  expect(rows).toHaveLength(8)
  expect(rows.at(-1)).toBe('')
  expect(new Set(rows.slice(0, 7).map(row => row.length))).toEqual(new Set([34]))
})

it('halves the height at scale 2', () => {
  const rows = renderWord('PIX')

  expect(scaleArt(rows, 2)).toHaveLength(rows.length / 2)
})

it('draws X symmetrically', () => {
  const glyph = BLOCK_GLYPHS.X!

  expect(glyph.map(row => [...row].reverse().join(''))).toEqual(glyph)
  expect([...glyph].reverse()).toEqual(glyph)
})

it('quotes the version in its own manifest', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string
  }

  expect(VERSION).toBe(manifest.version)
})
