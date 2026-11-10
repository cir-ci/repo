import { isSha256 } from '@circi/core'
import { findUpload, storeUpload } from '@circi/services'
import { ChecksumMismatchError } from '@circi/storage'
import multipart from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import type { Deps } from '#http/lib/deps.ts'
import { parse } from '#http/lib/validation.ts'
import { MAX_SCREENSHOT_BYTES } from '#http/routes/v1/schemas.ts'

// The upload target is called without the team token (as a presigned URL would be): the
// file's hash is the credential, because the bytes are stored only if they match it.
export const uploadRoutes: FastifyPluginAsync<Deps.V2> = async (uploads, deps) => {
  await uploads.register(multipart, { limits: { fileSize: MAX_SCREENSHOT_BYTES, files: 1 } })
  uploads.post('/uploads/:buildId/:sha256', async (req, reply) => {
    const { buildId, sha256: hash } = parse(
      z.object({ buildId: z.uuid(), sha256: z.string() }),
      req.params,
    )
    const file = isSha256(hash)
      ? await findUpload(deps.db, { sha256: hash, buildId })
      : ({ state: 'unknown' } as const)
    if (file.state === 'unknown') {
      return reply.code(404).send({ error: "This build didn't ask for that file" })
    }
    if (file.state === 'verified') {
      await req.file().catch(() => undefined)
      return reply.code(204).send()
    }
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'Send the file as a multipart form' })
    try {
      const stored = await storeUpload(deps.db, deps.storage, {
        sha256: hash,
        storageKey: file.storageKey,
        contentType: file.contentType,
        content: part.file,
        accept: () => !part.file.truncated,
      })
      if (stored.status === 'rejected') {
        return reply.code(413).send({ error: `Files are limited to ${MAX_SCREENSHOT_BYTES} bytes` })
      }
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ChecksumMismatchError) {
        return reply
          .code(422)
          .send({ error: `The uploaded bytes hash to ${err.actual}, not ${hash}` })
      }
      throw err
    }
  })
}
