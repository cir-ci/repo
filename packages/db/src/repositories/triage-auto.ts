import { and, eq, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm'

import { projects, triageItems, workspaceDeletions, workspaceSettings } from '#schema/index.ts'
import type { Database } from '#src/client.ts'

import { type TriageItem, checkRef } from './triage.ts'

/**
 * The "assign new triage items to whoever is on triage" setting, at the store: which projects have
 * it on, and handing items over without overriding a person. Which items are open, and who is on
 * triage, is the service's call (`autoAssignTriage` in `@circi/services`).
 */

/**
 * Projects where the setting is on (the project's own value, else the workspace's) and that have a
 * rotation, in live workspaces. `workspaceId` or `projectId` narrows the list.
 */
export async function listProjectsAssigningToOnCall(
  db: Database,
  scope: { workspaceId?: string; projectId?: string } = {},
): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, projects.workspaceId))
    .where(
      and(
        isNotNull(projects.triageRotationStartsOn),
        sql`coalesce(${projects.assignTriageToOnCall}, ${workspaceSettings.assignTriageToOnCall}, false)`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(workspaceDeletions)
            .where(eq(workspaceDeletions.workspaceId, projects.workspaceId)),
        ),
        scope.workspaceId === undefined ? undefined : eq(projects.workspaceId, scope.workspaceId),
        scope.projectId === undefined ? undefined : eq(projects.id, scope.projectId),
      ),
    )
  return rows.map((r) => r.id)
}

/**
 * Gives each item to `assigneeId` as an automatic assignment, and returns the ones that changed.
 * An item is taken when nobody holds it and nobody has said it should stay unassigned, or when it
 * is held by an earlier automatic assignment (the handover). An item a person assigned or
 * unassigned, a dismissed one, and one that is already the assignee's, is left as it is. Each
 * item is one statement, so two callers racing change (and so announce) an item once.
 */
export async function autoAssignTriageItems(
  db: Database,
  input: { projectId: string; assigneeId: string; items: Pick<TriageItem.Ref, 'kind' | 'key'>[] },
): Promise<{ kind: string; key: string }[]> {
  const changed: { kind: string; key: string }[] = []
  for (const item of input.items) {
    const kind = checkRef({ projectId: input.projectId, ...item })
    // eslint-disable-next-line no-await-in-loop -- one transaction, one connection
    const rows = await db
      .insert(triageItems)
      .values({
        projectId: input.projectId,
        kind,
        key: item.key,
        assigneeId: input.assigneeId,
        assignmentSource: 'auto',
      })
      .onConflictDoUpdate({
        target: [triageItems.projectId, triageItems.kind, triageItems.key],
        set: { assigneeId: input.assigneeId, assignmentSource: 'auto' },
        setWhere: and(
          isNull(triageItems.dismissedAt),
          or(
            and(
              isNull(triageItems.assigneeId),
              or(isNull(triageItems.assignmentSource), eq(triageItems.assignmentSource, 'auto')),
            ),
            and(
              eq(triageItems.assignmentSource, 'auto'),
              sql`${triageItems.assigneeId} is distinct from ${input.assigneeId}`,
            ),
          ),
        ),
      })
      .returning({ id: triageItems.id })
    if (rows.length > 0) changed.push(item)
  }
  return changed
}
