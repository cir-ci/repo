import type { Database } from '@circi/db'
import { listProjectMembers, listWorkspaceMemberRoles } from '@circi/db/queries'
import { markInstallationNeedsAttention } from '@circi/db/queue'
import { setIntegrationAttention } from '@circi/db/repositories'
import { integrationRegistry } from '@circi/integrations'

import { canManageWorkspace } from '#src/access/index.ts'

import { notify } from './notifications.ts'

/**
 * Notices nobody caused: a connection that stopped working, a screenshot that turned flaky. Both
 * run in the caller's transaction, and both are called only on the change itself (a connection
 * going from working to flagged, a screenshot entering the flaky list), which is what keeps them
 * from repeating. They are inbox-only: no email or push preference covers these kinds.
 */

export namespace notifyConnectionNeedsAttention {
  export interface Input {
    workspaceId: string
    integrationId: string
    /** The integration kind (`github`, `slack`…). */
    kind: string
    /** What a person calls the connection. */
    name: string
    reason: string
  }
}

/** Tells the workspace's owners and admins that CirCI can't use a connection until it's reconnected. */
export async function notifyConnectionNeedsAttention(
  db: Database,
  input: notifyConnectionNeedsAttention.Input,
): Promise<number> {
  const members = await listWorkspaceMemberRoles(db, input.workspaceId)
  const managers = members.filter(
    (m) => canManageWorkspace({ userId: m.userId, instanceAdmin: false, role: m.role }).allow,
  )
  for (const manager of managers) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    await notify(db, {
      userId: manager.userId,
      kind: 'connection_needs_attention',
      // The workspace is what the inbox checks the person's role and sign-in method against.
      workspaceId: input.workspaceId,
      actorId: null,
      payload: {
        integrationId: input.integrationId,
        integrationKind: input.kind,
        // Whether it reports on pull requests, from the registry (the dashboard words it by this).
        git: Boolean(integrationRegistry.get(input.kind)?.capabilities.git),
        name: input.name,
        reason: input.reason,
      },
    })
  }
  return managers.length
}

/**
 * Flags one integration as unusable and, when it was working until now, tells its workspace's
 * owners and admins. A connection already flagged keeps its first failure and tells nobody again;
 * `replaceIntegrationCredentials` or a successful call clears the flag, which re-arms the notice.
 */
export async function flagIntegrationAttention(
  db: Database,
  integrationId: string,
  reason: string,
): Promise<void> {
  const flagged = await setIntegrationAttention(db, integrationId, reason)
  if (!flagged) return
  await notifyConnectionNeedsAttention(db, {
    workspaceId: flagged.workspaceId,
    integrationId: flagged.id,
    kind: flagged.kind,
    name: flagged.displayName,
    reason,
  })
}

/** The same for every workspace's connection to one host installation (a git host removed our App). */
export async function flagInstallationAttention(
  db: Database,
  input: { kind: string; installationId: string; reason: string },
): Promise<void> {
  const flagged = await markInstallationNeedsAttention(
    db,
    input.kind,
    input.installationId,
    input.reason,
  )
  for (const connection of flagged) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    await notifyConnectionNeedsAttention(db, {
      workspaceId: connection.workspaceId,
      integrationId: connection.id,
      kind: connection.kind,
      name: connection.displayName,
      reason: input.reason,
    })
  }
}

export namespace notifyFlakyDetected {
  export interface Input {
    projectId: string
    /** The build whose change made these screenshots flaky, when a build did (not a threshold change). */
    buildId?: string | null
    /** The screenshots that just entered the project's flaky list. */
    names: readonly string[]
  }
}

/**
 * Tells the project's members that screenshots just turned flaky: one notice each, naming up to
 * all of them, about the build that tipped it. The caller passes only names that were not flagged
 * before, so a screenshot that stays flaky is never announced twice.
 */
export async function notifyFlakyDetected(
  db: Database,
  input: notifyFlakyDetected.Input,
): Promise<number> {
  if (input.names.length === 0) return 0
  const members = await listProjectMembers(db, input.projectId)
  for (const m of members) {
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    await notify(db, {
      userId: m.id,
      kind: 'flaky_detected',
      buildId: input.buildId ?? null,
      projectId: input.projectId,
      actorId: null,
      // The first name and how many, not the list: it is copied to every member.
      payload: { name: input.names[0], count: input.names.length },
    })
  }
  return members.length
}
