import { readFileSync } from 'node:fs'

/** pix's own version, read from its manifest so the welcome mark can never
 *  quote a number the package does not have. */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version
