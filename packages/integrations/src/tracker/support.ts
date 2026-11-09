import { isConnectionRevoked } from '#src/git/provider.ts'
import type { IntegrationDefinition } from '#src/sdk/definition.ts'
import { IntegrationUnreachableError, InvalidCredentialsError } from '#src/sdk/errors.ts'

import { type IssueTracker } from './tracker.ts'

/** What Linear and Jira share: how their adapters become connect results, targets and attention. */

/** Verifies the credentials with the tracker (`identify`): 400 when it refuses them, 502 when it is down. */
export async function identifyAccount(
  name: string,
  tracker: IssueTracker,
): Promise<IssueTracker.Account> {
  try {
    return await tracker.identify()
  } catch (err) {
    if (isConnectionRevoked(err)) {
      throw new InvalidCredentialsError(`${name} did not accept those credentials`, { cause: err })
    }
    throw new IntegrationUnreachableError(`${name} did not answer; try again shortly`, {
      cause: err,
    })
  }
}

/** The Linear teams or Jira projects an issue can go to, as the mapping's targets. */
export async function trackerTargets(
  tracker: IssueTracker | undefined,
): Promise<IntegrationDefinition.Target[]> {
  if (!tracker) return []
  return (await tracker.listTargets()).map((t) => ({ id: t.ref, name: t.name }))
}

/** The reason to flag the integration when the tracker no longer accepts the credentials (401, 403). */
export const trackerAttention = (name: string, err: unknown): string | null =>
  isConnectionRevoked(err) ? `${name} no longer accepts the saved credentials` : null
