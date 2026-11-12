import { isSha256 } from '@circi/core'
import { signFileUrl } from '@circi/core/node'
import type { preSerializationAsyncHookHandler } from 'fastify'

/**
 * Signs the file hashes a dashboard reply carries in a field that is a file reference: a key that
 * ends in `Sha256` (or is `sha256`) or is `thumb` / `thumbnail`, as the read models name them.
 * Text a user wrote (a comment, a screenshot name, an error) is never signed, even when it looks
 * like a hash: only the field's name says "this is a file the query joined", and a route that
 * returns such a field has already
 * decided the signed-in user may see it, so each hash in the reply gets a signed, expiring link
 * (`GET /api/files/:sha256?exp&sig`, see `builds/files.ts`) that needs no session and no access
 * query to serve. The signatures travel in the reply's `fileSignatures`, `{ [hash]: "<exp>.<sig>" }`,
 * which the web app reads and removes (`lib/file-signatures.ts`). Only replies that are objects
 * carry it; for an array, or when there is no secret, the web app's plain links keep working
 * through the session.
 */
export function signFileHashes(secret: string): preSerializationAsyncHookHandler {
  return async (_req, _reply, payload) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
    const hashes = new Set<string>()
    collectHashes(payload, hashes, 0)
    if (hashes.size === 0) return payload
    const fileSignatures: Record<string, string> = {}
    for (const sha256 of hashes) {
      const { exp, sig } = signFileUrl(secret, sha256)
      fileSignatures[sha256] = `${exp}.${sig}`
    }
    return { ...payload, fileSignatures }
  }
}

const MAX_DEPTH = 12

/** Field names the read models use for a reference to a stored image. */
const FILE_FIELD = /^(?:sha256|thumb|thumbnail|[a-z]\w*Sha256)$/

function collectHashes(value: unknown, into: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH) return
  if (Array.isArray(value)) {
    for (const item of value) collectHashes(item, into, depth + 1)
  } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (FILE_FIELD.test(key) && isSha256(item)) into.add(item)
      } else collectHashes(item, into, depth + 1)
    }
  }
}
