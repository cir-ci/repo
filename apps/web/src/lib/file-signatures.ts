/**
 * Signed links to screenshots, diffs and thumbnails. A reply that carries file hashes also carries
 * `fileSignatures`, `{ [hash]: "<exp>.<sig>" }` (see the server's `hooks/file-signatures.ts`); the
 * fetch wrapper hands each reply to `absorbFileSignatures`, which remembers them and takes the key
 * out, and `signedFileQuery` gives the query string for a hash. With no signature (or one about
 * to expire) the plain link still works through the session.
 */

const known = new Map<string, { exp: number; sig: string }>()

/** A link must have this long left to be handed out. */
const MARGIN_SECONDS = 60

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Remembers the signatures in `body` and removes them from it; anything else is left alone. */
export function absorbFileSignatures(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return
  if (!('fileSignatures' in body)) return
  const signatures: unknown = body.fileSignatures
  Reflect.deleteProperty(body, 'fileSignatures')
  if (typeof signatures !== 'object' || signatures === null) return
  const now = nowSeconds()
  for (const [hash, entry] of known) if (entry.exp <= now) known.delete(hash)
  for (const [sha256, value] of Object.entries(signatures)) {
    if (typeof value !== 'string') continue
    const [exp, sig] = value.split('.')
    if (exp && sig && Number(exp) > now) known.set(sha256, { exp: Number(exp), sig })
  }
}

/** `?exp=…&sig=…` for a hash with a fresh signature, otherwise an empty string. */
export function signedFileQuery(sha256: string): string {
  const entry = known.get(sha256)
  if (!entry || entry.exp - nowSeconds() < MARGIN_SECONDS) return ''
  return `?exp=${entry.exp}&sig=${entry.sig}`
}

/** For tests: forgets every signature. */
export function clearFileSignatures(): void {
  known.clear()
}
