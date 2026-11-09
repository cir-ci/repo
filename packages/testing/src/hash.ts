import { createHash } from 'node:crypto'

/** The real sha256 (hex) of some bytes or text. */
export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** A fake sha256 made of one repeated hex digit. */
export const fakeSha = (c: string) => c.repeat(64).slice(0, 64)

/** @deprecated the old name of `fakeSha`, kept while other test files still import it. */
export const sha = fakeSha
