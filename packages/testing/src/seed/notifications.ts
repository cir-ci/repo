import { type Database, type Notification, schema } from '@circi/db'

export interface SeedNotificationInput {
  userId: string
  kind?: Notification['kind']
  buildId?: string | null
  actorId?: string | null
  payload?: Record<string, unknown>
  readAt?: Date | null
  snoozedUntil?: Date | null
  deletedAt?: Date | null
  createdAt?: Date
}

/** A notification, inserted as given (any state or time), for inbox-shaped tests. */
export async function seedNotification(
  db: Database,
  input: SeedNotificationInput,
): Promise<Notification> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      kind: input.kind ?? 'review_requested',
      buildId: input.buildId ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      readAt: input.readAt ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
      deletedAt: input.deletedAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}
