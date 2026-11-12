import { isSha256 } from '@circi/core'
import { signFileUrl } from '@circi/core/node'
import type { preSerializationAsyncHookHandler } from 'fastify'

/**
 * Signs the file hashes a dashboard reply carries. A route that returns a hash has already
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

function collectHashes(value: unknown, into: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    if (isSha256(value)) into.add(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectHashes(item, into, depth + 1)
  } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    for (const item of Object.values(value)) collectHashes(item, into, depth + 1)
  }
}
