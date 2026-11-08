import { createHmac } from 'node:crypto'

import { isConnectionRevoked, ProviderApiError } from '@circi/providers'

import type { IntegrationDefinition } from './definition.ts'
import {
  IntegrationNotFoundError,
  IntegrationUnreachableError,
  InvalidCredentialsError,
  InvalidInputError,
} from './errors.ts'

/** What the git host definitions share: payload reading, webhook secrets, error mapping. */

/** An object payload's fields; `{}` for anything else. */
export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}

/** A string or number field as a string. */
export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

/**
 * The webhook secret of a host whose secret is not configured by hand: derived from the instance
 * secret, so every instance has its own and nothing needs storing. Shown to owners and admins.
 */
export const derivedWebhookSecret = (authSecret: string, kind: string): string =>
  createHmac('sha256', authSecret).update(`circi:${kind}-webhook`).digest('hex')

/**
 * The adapter a test stood in for the host (`Context.gitProviders`), typed as the real one: the
 * stub has only the methods the test's code path calls, which is the point of a fake at the edge.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the adapter the stub stands for
export function stubbed<T extends object>(
  ctx: IntegrationDefinition.Context,
  kind: string,
): T | undefined {
  const stub = ctx.gitProviders?.[kind]
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake of the host's edge, by design
  return stub ? (stub as T) : undefined
}

/**
 * How a failed call that proves a token or installation maps to what the connect form answers:
 * the host refusing it (400, or 404 for a missing installation), the person pointing it at something
 * it cannot read (400 with the host's reason), or the host not answering (502).
 */
export function connectFailure(
  host: string,
  err: unknown,
  messages: { revoked: string; forbidden?: string; notFound?: string; revokedIsNotFound?: true },
): Error {
  if (isConnectionRevoked(err)) {
    return messages.revokedIsNotFound
      ? new IntegrationNotFoundError(messages.revoked, { cause: err })
      : new InvalidCredentialsError(messages.revoked, { cause: err })
  }
  if (err instanceof ProviderApiError) {
    if (err.status === 403 && messages.forbidden) {
      return new InvalidInputError(messages.forbidden, { cause: err })
    }
    if (err.status === 404 && messages.notFound) {
      return new InvalidInputError(messages.notFound, { cause: err })
    }
  }
  return new IntegrationUnreachableError(`${host} did not answer; try again shortly`, {
    cause: err,
  })
}
