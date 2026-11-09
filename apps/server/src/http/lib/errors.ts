import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@circi/core'
import { IntegrationError, type IntegrationErrorCode } from '@circi/integrations'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

/** The status each integration error code answers with. */
const INTEGRATION_STATUS: Record<IntegrationErrorCode, number> = {
  invalid_credentials: 400,
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  unreachable: 502,
}

/** The status a thrown error answers with, or undefined when it is not one of ours. */
function domainStatus(err: Error): number | undefined {
  if (err instanceof ValidationError) return 400
  if (err instanceof NotFoundError) return 404
  if (err instanceof ForbiddenError) return 403
  if (err instanceof ConflictError) return 409
  if (err instanceof IntegrationError) return INTEGRATION_STATUS[err.code]
  return undefined
}

/**
 * Maps errors to HTTP for JSON scopes (see `domainStatus`; integration errors by their code).
 * Fastify's own client errors (bad JSON, body too large…) keep their status; anything else is a
 * 500 that's logged and never leaks details.
 */
export function jsonErrorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const status = domainStatus(err)
  if (status !== undefined) {
    // A provider that is down or confused is worth a line; the person only sees the message.
    if (err instanceof IntegrationError && status >= 500) {
      req.log.warn({ err }, 'integration provider call failed')
    }
    return reply.code(status).send({ error: err.message })
  }
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
