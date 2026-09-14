// The wordmark is a bitmap, not a picture: every cell is either filled or not,
// and a scale factor downsamples it through half-block characters, so the same
// source draws at two sizes. Ported from the OpenDDE Harness TUI's branding,
// trimmed to the three letters pix needs.

/** Bitmap rows per letter, one character per cell. */
export const BLOCK_GLYPHS: Record<string, readonly string[]> = {
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001']
}

/** Each bitmap cell is drawn two columns wide, letters one cell apart. */
const CELL_BLOCK = '██'
const CELL_EMPTY = '  '
const LETTER_GAP = '  '

/** A word as block letters, plus a blank row.
 *
 *  The blank keeps the height a multiple of the scale factors, so downsampling
 *  never bleeds the letters into whatever is drawn under them. */
export function renderWord(word: string): string[] {
  const rows = Array.from({ length: 7 }, (_, row) =>
    [...word]
      .map(letter => (BLOCK_GLYPHS[letter] ?? BLOCK_GLYPHS.I)![row]!.replaceAll('1', CELL_BLOCK).replaceAll('0', CELL_EMPTY))
      .join(LETTER_GAP)
  )

  return [...rows, '']
}

function artWidth(rows: readonly string[]): number {
  return rows.reduce((width, row) => Math.max(width, [...row].length), 0)
}

const isFilled = (row: readonly string[], col: number) => {
  const char = row[col]

  return char !== undefined && char !== ' '
}

/**
 * Downsample block art by `factor`: one output cell covers a factor-wide,
 * factor-tall block of the bitmap, and the upper and lower halves of that block
 * become the two halves of one terminal cell. Factor 2 turns two source rows
 * into one row of half blocks, which is how the same mark draws at two sizes
 * without a second drawing.
 *
 * A half is drawn when any of it is filled. That dilates, which at factor 2 is
 * free — a half-block there is two source cells, so half of it is any of it —
 * and factor 2 is the only reduction pix uses.
 */
export function scaleArt(rows: readonly string[], factor: number): string[] {
  if (factor <= 1) {
    return rows.map(row => row.trimEnd())
  }

  const bitmap = rows.map(row => [...row])
  const width = artWidth(rows)
  const half = Math.max(1, Math.floor(factor / 2))
  const anyFilled = (rowStart: number, rowCount: number, colStart: number) => {
    for (let r = rowStart; r < rowStart + rowCount; r++) {
      const row = bitmap[r]

      if (!row) {
        continue
      }

      for (let c = colStart; c < colStart + factor; c++) {
        if (isFilled(row, c)) {
          return true
        }
      }
    }

    return false
  }

  const out: string[] = []

  for (let i = 0; i < Math.ceil(rows.length / factor); i++) {
    let line = ''

    for (let j = 0; j < Math.ceil(width / factor); j++) {
      const top = anyFilled(i * factor, half, j * factor)
      const bottom = anyFilled(i * factor + half, factor - half, j * factor)

      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }

    out.push(line.trimEnd())
  }

  return out
}
