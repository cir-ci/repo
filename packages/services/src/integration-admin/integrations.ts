import { NotFoundError, sealSecret } from '@circi/core'
import { type Database } from '@circi/db'
import {
  createIntegration,
  deleteIntegration,
  deleteIntegrationLink,
  findIntegrationByExternalId,
  isAccountClaimedElsewhere,
  replaceIntegrationCredentials,
  setIntegrationAttention,
} from '@circi/db/repositories'
import { type IntegrationDefinition, IntegrationConflictError } from '@circi/integrations'

/**
 * What a workspace's owners and admins do to its integrations: connect one, remove one, remove a
 * team's link, and flag one when its provider stops accepting it.
 */

export namespace connectIntegration {
  export interface Input {
    workspaceId: string
    /** Who connects it (recorded as the creator of a new connection). */
    userId: string
    definition: IntegrationDefinition
    /** What the definition's `connect` (or OAuth `exchange`) returned, after checking with the provider. */
    connected: IntegrationDefinition.ConnectResult
    ctx: IntegrationDefinition.Context
    /** Replace the credentials of the same account when it is connected already (an OAuth install). */
    replace: boolean
  }
}

/**
 * Stores a connected account, its credentials sealed, and returns the integration's id. An
 * `exclusive` definition refuses an account another workspace already uses (conflict). A
 * reconnect of the same account replaces its credentials (always when `replace`, and for a
 * definition with `replaceOnReconnect`); otherwise the same account twice is a conflict (the
 * unique index).
 */
export async function connectIntegration(
  db: Database,
  input: connectIntegration.Input,
): Promise<string> {
  const { definition, connected, ctx, workspaceId } = input
  const kind = definition.id
  const sealed = connected.credentials ? sealSecret(ctx.authSecret, connected.credentials) : null
  return db.transaction(async (tx) => {
    if (
      definition.exclusive?.account &&
      (await isAccountClaimedElsewhere(tx, kind, connected.externalId, workspaceId))
    ) {
      throw new IntegrationConflictError(
        `That ${definition.name} account is already connected to another workspace`,
      )
    }
    const existing =
      input.replace || definition.replaceOnReconnect
        ? await findIntegrationByExternalId(tx, workspaceId, kind, connected.externalId)
        : undefined
    if (existing) {
      await replaceIntegrationCredentials(tx, existing.id, {
        displayName: connected.displayName,
        encryptedCredentials: sealed,
      })
      return existing.id
    }
    const created = await createIntegration(tx, {
      workspaceId,
      kind,
      displayName: connected.displayName,
      externalId: connected.externalId,
      encryptedCredentials: sealed,
      createdBy: input.userId,
    })
    return created.id
  })
}

/** Removes an integration; every team mapped to it stops using it. Throws when it is not the workspace's. */
export async function removeIntegration(
  db: Database,
  input: { workspaceId: string; integrationId: string },
): Promise<void> {
  const removed = await db.transaction((tx) =>
    deleteIntegration(tx, input.workspaceId, input.integrationId),
  )
  if (!removed) throw new NotFoundError('Integration not found')
}

/** Removes one of a team's links of the integration. Throws when there is no such link. */
export async function removeTeamLink(
  db: Database,
  input: { integrationId: string; teamId: string; linkId: string },
): Promise<void> {
  const removed = await db.transaction((tx) =>
    deleteIntegrationLink(tx, input.integrationId, input.linkId, input.teamId),
  )
  if (!removed) throw new NotFoundError('Link not found')
}

export namespace flagFailedIntegration {
  export interface Input {
    integrationId: string
    /** Undefined when the kind is not registered (nothing then recognises the failure). */
    definition: IntegrationDefinition | undefined
    /** What the provider call threw. */
    error: unknown
  }
}

/**
 * Flags the integration "needs attention" when the definition recognises the error as one a
 * person has to act on (a revoked token, a removed app). Returns the reason stored, or undefined
 * when the error is not that kind and nothing was changed.
 */
export async function flagFailedIntegration(
  db: Database,
  input: flagFailedIntegration.Input,
): Promise<string | undefined> {
  const reason = input.definition?.needsAttention(input.error)
  if (!reason) return undefined
  await db.transaction((tx) => setIntegrationAttention(tx, input.integrationId, reason))
  return reason
}
