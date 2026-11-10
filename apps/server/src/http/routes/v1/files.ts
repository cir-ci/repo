import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { findUpload, storeUpload } from '@circi/services'
import { ChecksumMismatchError } from '@circi/storage'
import type { FastifyPluginAsync } from 'fastify'

import type { Deps } from '#http/lib/deps.ts'
import { byteLimit, TooLargeError } from '#http/lib/streams.ts'
import { parse } from '#http/lib/validation.ts'

import { fileParams, MAX_SCREENSHOT_BYTES } from './schemas.ts'

/**
 * `PUT /v1/files/:sha256`: uploads through the API, used with local-disk storage. The bytes are
 * hashed while streaming and stored only if they match (PLAN §8 "verify before dedup").
 */
export const fileRoutes: FastifyPluginAsync<Deps.V1> = async (app, deps) => {
  app.put('/files/:sha256', async (req, reply) => {
    const { sha256: hash } = parse(fileParams, req.params)
    const file = await findUpload(deps.db, { sha256: hash })
    if (file.state === 'unknown') {
      return reply
        .code(404)
        .send({ error: "This file wasn't requested by any build (POST /v1/builds first)" })
    }
    const body = req.body
    if (!(body instanceof Readable)) {
      return reply
        .code(415)
        .send({ error: 'Send the file as image/png or application/octet-stream' })
    }
    if (file.state === 'verified') {
      body.resume() // Already have it; drain and succeed.
      return reply.code(200).send({ sha256: hash, status: 'verified' })
    }
    // pipeline (not .pipe) so a client abort or an oversized body also destroys `limited`,
    // which makes storage.put fail and discard its temporary file.
    const limited = byteLimit(MAX_SCREENSHOT_BYTES)
    pipeline(body, limited).catch(() => {})
    try {
      await storeUpload(deps.db, deps.storage, {
        sha256: hash,
        storageKey: file.storageKey,
        contentType: file.contentType,
        content: limited,
      })
      return reply.code(201).send({ sha256: hash, status: 'verified' })
    } catch (err) {
      if (err instanceof ChecksumMismatchError) {
        return reply
          .code(422)
          .send({ error: `The uploaded bytes hash to ${err.actual}, not ${hash}` })
      }
      if (err instanceof TooLargeError) {
        return reply.code(413).send({ error: `Files are limited to ${MAX_SCREENSHOT_BYTES} bytes` })
      }
      throw err
    }
  })
}
