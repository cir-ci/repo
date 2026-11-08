import { type Database, schema } from '@circi/db'

export interface SeedSavedViewInput {
  userId: string
  orgId: string
  projectId?: string | null
  name?: string
  filters?: typeof schema.savedViews.$inferInsert.filters
  pinned?: boolean
  position?: number
}

let n = 0

/** A saved view, inserted as given. */
export async function seedSavedView(db: Database, input: SeedSavedViewInput) {
  n += 1
  const [row] = await db
    .insert(schema.savedViews)
    .values({
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      name: input.name ?? `View ${n}`,
      filters: input.filters ?? {},
      pinned: input.pinned ?? false,
      position: input.position ?? 0,
    })
    .returning()
  if (!row) throw new Error('seed insert returned no row')
  return row
}

/** Pins a project for a user at a position. */
export async function seedPinnedProject(
  db: Database,
  input: { userId: string; projectId: string; position?: number },
): Promise<void> {
  await db.insert(schema.userPinnedProjects).values({ ...input, position: input.position ?? 0 })
}
