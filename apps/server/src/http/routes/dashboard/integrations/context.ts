import { ConflictError, NotFoundError, openSecret, ValidationError } from '@circi/core'
import { getIntegration } from '@circi/db/queries'
import {
  IntegrationError,
  IntegrationUnreachableError,
  type IntegrationDefinition,
  integrationRegistry,
} from '@circi/integrations'
import { connectIntegration, flagFailedIntegration } from '@circi/services'
import type { FastifyRequest } from 'fastify'

import { integrationContext } from '#composition/integration-context.ts'
import type { Deps } from '#http/lib/deps.ts'
import { loadWorkspace } from '#http/lib/workspace-access.ts'

/**
 * The integration's opened credentials; a conflict (409) when they cannot be read. A `secretless`
 * definition (an App-based git host) keeps none: its capabilities get an empty string.
 */
export function credentialsFor(
  loaded: {
    integration: { encryptedCredentials: string | null }
    definition: IntegrationDefinition
  },
  ctx: IntegrationDefinition.Context,
) {
  if (loaded.definition.secretless) return ''
  const credentials = loaded.integration.encryptedCredentials
    ? openSecret(ctx.authSecret, loaded.integration.encryptedCredentials)
    : undefined
  if (credentials === undefined) {
    throw new ConflictError(
      `The ${loaded.definition.name} credentials cannot be read; connect it again`,
    )
  }
  return credentials
}

/** The pieces the generic routes share. */
export function createGeneric(deps: Deps.Dashboard) {
  const registry = deps.integrations?.registry ?? integrationRegistry

  const loadForManager = (req: FastifyRequest) =>
    loadWorkspace(deps, req, {
      manage: true,
      forbidden: 'Only owners and admins can manage integrations',
    })

  /** The registered definition for `:kind`; not found (404) for an unknown one. */
  function definitionFor(kind: string) {
    const definition = registry.get(kind)
    if (!definition) throw new NotFoundError('Integration not found')
    return definition
  }

  /** The integration of the workspace named by `:id`, with its definition; not found (404) otherwise. */
  async function integrationFor(workspaceId: string, id: string) {
    const integration = await getIntegration(deps.db, workspaceId, id)
    const definition = integration ? registry.get(integration.kind) : undefined
    if (!integration || !definition) throw new NotFoundError('Integration not found')
    return { integration, definition }
  }

  /** The instance context; a validation error (400) when it cannot seal credentials. */
  function contextFor() {
    const ctx = integrationContext(deps)
    if (!ctx) throw new ValidationError('This instance cannot store credentials')
    return ctx
  }

  /** Stores a connected account (see `connectIntegration`); returns the integration's id. */
  const store = (
    workspaceId: string,
    userId: string,
    definition: IntegrationDefinition,
    connected: IntegrationDefinition.ConnectResult,
    ctx: IntegrationDefinition.Context,
    options: { replace: boolean },
  ) =>
    connectIntegration(deps.db, {
      workspaceId,
      userId,
      definition,
      connected,
      ctx,
      replace: options.replace,
    })

  /**
   * Throws for a failed call to the provider: the definition's own errors keep their status, an
   * error it recognises as "a person has to act" flags the integration (409), anything else is a 502.
   */
  async function providerFailed(
    req: FastifyRequest,
    loaded: { integration: { id: string }; definition: IntegrationDefinition },
    err: unknown,
  ): Promise<never> {
    const { integration, definition } = loaded
    if (err instanceof IntegrationError) throw err // the error handler maps it by its code
    const flagged = await flagFailedIntegration(deps.db, {
      integrationId: integration.id,
      definition,
      error: err,
    })
    if (flagged) {
      throw new ConflictError(`${definition.name} no longer accepts this connection; reconnect it`)
    }
    req.log.warn({ err }, `the ${definition.name} call failed`)
    throw new IntegrationUnreachableError(`${definition.name} did not answer; try again shortly`)
  }

  return {
    registry,
    loadForManager,
    definitionFor,
    integrationFor,
    contextFor,
    store,
    providerFailed,
  }
}
