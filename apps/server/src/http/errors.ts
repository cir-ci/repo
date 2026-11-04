import { ValidationError } from '@circi/core'
import { ConflictError, NotFoundError } from '@circi/db'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Maps domain errors to HTTP for JSON scopes: validation → 400, not found → 404, conflict → 409.
 * Fastify's own client errors (bad JSON, body too large…) keep their status; anything else is a
 * 500 that's logged and never leaks details.
 */
export function jsonErrorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message })
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message })
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message })
  if (
    'statusCode' in err &&
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  req.log.error({ err }, 'request failed')
  return reply.code(500).send({ error: 'Internal server error' })
}
