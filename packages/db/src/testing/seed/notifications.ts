import * as schema from '#schema/index.ts'
import { type Database, type Notification } from '#src/index.ts'

import { nextCreatedAt } from '../created-at.ts'

export namespace seedNotification {
  export interface Input {
    userId: string
    kind?: Notification['kind']
    buildId?: string | null
    projectId?: string | null
    workspaceId?: string | null
    actorId?: string | null
    payload?: Record<string, unknown>
    readAt?: Date | null
    snoozedUntil?: Date | null
    deletedAt?: Date | null
    createdAt?: Date
  }
}

/** A notification, inserted as given (any state or time), for inbox-shaped tests. */
export async function seedNotification(
  db: Database,
  input: seedNotification.Input,
): Promise<Notification> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      kind: input.kind ?? 'review_requested',
      buildId: input.buildId ?? null,
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      readAt: input.readAt ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
      deletedAt: input.deletedAt ?? null,
      createdAt: input.createdAt ?? nextCreatedAt(),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
